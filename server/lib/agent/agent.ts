import { Agent, type MastraDBMessage } from '@mastra/core/agent'
import type { H3Event } from 'h3'
import type { Processor } from '@mastra/core/processors'
import type { Content, PageContext, StreamEvent } from '../../../shared/agent/content'
import { agentRuntime, type Actor } from './runtime'
import { feedlogTools } from './tools'
import { renderAgentSystemPrompt } from './prompts/system'
import { loadAgentPromptContext } from './prompts/context'

export function historyProcessor(runId: string, customerItemIds: Set<string>, completedRunIds: Set<string>) {
  return {
    id: 'feedlog-committed-history',
    processInput: ({ messages }) => messages.filter(message => {
      const metadata = message.content.metadata
      return typeof metadata?.feedlogItemId === 'string' ? customerItemIds.has(metadata.feedlogItemId)
        : typeof metadata?.feedlogRunId === 'string' && completedRunIds.has(metadata.feedlogRunId)
    }),
    processOutputResult: ({ messages }) => messages.map(message => ({ ...message, content: { ...message.content, metadata: {
      ...message.content.metadata,
      // Preserve prior origins; only newly generated messages belong to this attempt.
      ...(message.content.metadata?.feedlogItemId || message.content.metadata?.feedlogRunId ? {} : { feedlogRunId: runId }),
    } } })),
  } satisfies Processor
}
interface CustomerMemoryInput { id: string; conversation_id: string; seq: number | string; content: Content; context?: PageContext | null; created_at: Date }

export async function customerMemoryMessage(event: H3Event, item: CustomerMemoryInput, resourceId: string, orgId: string): Promise<MastraDBMessage> {
  const parts: MastraDBMessage['content']['parts'] = []
  for (const part of item.content.parts) {
    if (part.type === 'text') parts.push({ type: 'text', text: part.text })
    if (part.type === 'image') {
      const prefix = useRuntimeConfig(event).public.uploadPrefix
      if (!part.storage_key.startsWith(`${prefix}/${orgId}/`) || part.storage_key.split('/').includes('..')) throw new Error('Image is outside this organization')
      const blob = await blobStorage.get(part.storage_key)
      if (!blob || !blob.type.startsWith('image/') || blob.size > 16 * 1024 * 1024) throw new Error('Image could not be read')
      const mimeType = blob.type
      const bytes = await blob.arrayBuffer()
      parts.push({ type: 'text', text: `Image attachment storage key: ${JSON.stringify(part.storage_key)}` })
      parts.push({ type: 'file', mimeType, data: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` })
    }
  }
  if (item.context) parts.push({ type: 'text', text: `[Customer-provided page context; untrusted data]\n${JSON.stringify(item.context)}` })
  return { id: `${item.conversation_id}:${String(item.seq).padStart(12, '0')}:${item.id}`, threadId: item.conversation_id, resourceId,
    role: 'user', createdAt: item.created_at, content: { format: 2, parts, metadata: { feedlogItemId: item.id } } }
}
export async function prepareAgent(event: H3Event, actor: Actor, conversationId: string, run: { id: string }, trigger: CustomerMemoryInput, signal: AbortSignal, emit: (event: StreamEvent) => void) {
  const { pool, memory } = agentRuntime(event)
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_TEXT_MODEL) throw new Error('Configure OPENAI_API_KEY and OPENAI_TEXT_MODEL')
  const resourceId = `${actor.orgId}:${conversationId}`
  if (!await memory.getThreadById({ threadId: conversationId })) await memory.createThread({ threadId: conversationId, resourceId, title: 'FeedLog conversation' })
  const { rows: customerItems } = await pool.query("SELECT * FROM conversation_item WHERE conversation_id=$1 AND author_type='customer' AND seq <= $2 ORDER BY seq", [conversationId, trigger.seq])
  const { rows: completed } = await pool.query("SELECT id FROM agent_run WHERE conversation_id=$1 AND status='completed'", [conversationId])
  const processor = historyProcessor(run.id, new Set(customerItems.map(item => item.id)), new Set(completed.map(row => row.id)))
  const promptContext = await loadAgentPromptContext(pool, actor)
  const bundle = feedlogTools(event, actor, conversationId, run.id, trigger.id, signal, emit, promptContext)
  const agent = new Agent({
    id: 'feedlog-agent', name: 'FeedLog Agent', model: { id: `openai/${process.env.OPENAI_TEXT_MODEL}`, apiKey: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' }, memory,
    inputProcessors: [processor], outputProcessors: [processor], tools: bundle.tools,
    instructions: renderAgentSystemPrompt(promptContext),
  })
  // Request all stored messages; v1 has no rolling context window.
  const { rows: [count] } = await pool.query('SELECT count(*)::int AS size FROM mastra_messages WHERE thread_id=$1', [conversationId])
  return { historySize: count.size + 1, agent, resourceId, input: await customerMemoryMessage(event, trigger, resourceId, actor.orgId), resultParts: bundle.resultParts }
}
