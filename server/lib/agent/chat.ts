import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import { toAISdkStream } from '@mastra/ai-sdk'
import { createEventStream, type H3Event } from 'h3'
import { chatInput, contentSchema } from '#layers/feedlog/shared/agent/content'
import { type Actor, agentRuntime, agentError, transaction, lockConversation, appendItem, publicRun } from '#layers/feedlog/server/lib/agent/runtime'
import { startRun, failRun } from '#layers/feedlog/server/lib/agent/conversations'
import { prepareAgent, customerMemoryMessage } from '#layers/feedlog/server/lib/agent/agent'
import { collectConversationReply } from '#layers/feedlog/server/lib/agent/stream'
import { addTokenUsage, type RunTokenUsage } from '#layers/feedlog/shared/agent/usage'

export async function streamAgentReply(event: H3Event, actor: Actor) {
  await assertGuestMay(event, actor.session, 'allowPost')
  const parsedId = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!parsedId.success) agentError(404, 'conversation_not_found', 'Conversation not found')
  const id = parsedId.data
  const parsed = chatInput.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) agentError(422, 'invalid_message', 'Message content or parameters are invalid')
  const runtime = agentRuntime(event)
  if (parsed.data.action === 'send') {
    // Validate attachment access before committing the input or starting a run.
    await customerMemoryMessage(event, { ...parsed.data.message, conversation_id: id, seq: 0, created_at: new Date() }, `${actor.orgId}:${id}`, actor.orgId)
      .catch(() => agentError(422, 'invalid_message', 'An image could not be read'))
  }
  if (!await checkRateLimit(`widget-messages:${actor.customerId}`, { limit: 20, windowSeconds: 60 })) agentError(429, 'rate_limited', 'Too many messages; try again shortly')
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_TEXT_MODEL) agentError(503, 'agent_unavailable', 'The assistant is temporarily unavailable')
  const execution = await startRun(runtime, id, actor, parsed.data)
  if (execution.duplicate) return { duplicate: true, run: publicRun(execution.run) }
  const { run, item } = execution
  const replyId = uuidv7()
  const stream = createEventStream(event)
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {})
  const task = (async () => {
    const signal = AbortSignal.timeout(Math.max(1, new Date(run.deadline_at).getTime() - Date.now()))
    let usage: RunTokenUsage | null = null
    try {
      await send('run', { runId: run.id, itemId: replyId })
      const prepared = await prepareAgent(event, actor, id, run, item, signal, () => {})
      let failed = false
      const output = await prepared.agent.stream([prepared.input], {
        runId: run.id, memory: { thread: id, resource: prepared.resourceId, options: { lastMessages: prepared.historySize } },
        maxSteps: 12, abortSignal: signal, onError: () => { failed = true }, onAbort: () => { failed = true },
        onStepFinish: async step => {
          usage = addTokenUsage(usage, step.usage)
          // Preserve reported costs even when a later step fails; metrics must not interrupt a reply.
          await runtime.pool.query('UPDATE agent_run SET usage=$2 WHERE id=$1', [run.id, JSON.stringify(usage)])
            .catch(() => console.warn('[agent] Could not persist step token usage', { runId: run.id }))
        },
      })
      const reply = await collectConversationReply(toAISdkStream(output, { from: 'agent', version: 'v7', sendReasoning: false, sendSources: false }), replyId, chunk => {
        if (chunk.type === 'text-delta') void send('text', { runId: run.id, itemId: replyId, delta: chunk.delta })
      })
      if (failed || signal.aborted) throw new Error('Model execution did not complete')
      await runtime.memory.settled()
      const text = reply.message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim()
      const content = contentSchema.parse({ parts: [...(text ? [{ type: 'text', text }] : []), ...await prepared.resultParts()] })
      const lastSeq = await transaction(runtime, async client => {
        await lockConversation(client, id, actor)
        const { rowCount } = await client.query("SELECT id FROM agent_run WHERE id=$1 AND status='running' AND deadline_at>clock_timestamp()", [run.id])
        if (!rowCount) throw new Error('Run no longer active')
        const reply = await appendItem(client, { id: replyId, conversationId: id, author: 'agent', content, runId: run.id })
        await client.query("UPDATE agent_run SET status='completed',finished_at=now(),usage=$2 WHERE id=$1", [run.id, usage ? JSON.stringify(usage) : null])
        return Number(reply.seq)
      })
      await send('finish', { runId: run.id, itemId: replyId, lastSeq })
    } catch {
      const message = signal.aborted ? 'The reply timed out. Please retry.' : 'The reply could not be completed. Please retry.'
      await failRun(runtime, run.id, message)
      await send('error', { runId: run.id, code: 'agent_failed', message })
    } finally { await stream.close() }
  })()
  event.context.feedlogAgentTask = task
  event.waitUntil(task)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return stream.send()
}
