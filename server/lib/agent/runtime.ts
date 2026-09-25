import { Pool, type PoolClient } from 'pg'
import { Memory } from '@mastra/memory'
import { MastraCompositeStore } from '@mastra/core/storage'
import { MemoryPG } from '@mastra/pg'
import { createError, type H3Event } from 'h3'
import type { Content, PageContext } from '../../../shared/agent/content'
import { stripMarkdown } from '../../../shared/utils/markdown'
import { CONVERSATION_RETENTION_DEFAULT_DAYS } from '../../../shared/constants/conversation'

function initialize(connectionString: string, worker = false) {
  const options = { connectionString, connectionTimeoutMillis: 10000, statement_timeout: 20000 }
  const pool = new Pool({ ...options, max: worker ? 2 : 4 })
  // Business transactions reserve tool effects in Memory. Separate pools avoid
  // waiting for a connection already held by those same transactions.
  const memoryPool = new Pool({ ...options, max: worker ? 1 : 2 })
  const storage = new MastraCompositeStore({ id: 'feedlog-agent', disableInit: true, domains: {
    memory: new MemoryPG({ pool: memoryPool, schemaName: 'public' }), threadState: false,
  } })
  const memory = new Memory({ storage, options: { lastMessages: false, generateTitle: false, semanticRecall: false, workingMemory: { enabled: false } } })
  return { pool, memory, close: async () => { await memory.settled(); await Promise.all([pool.end(), memoryPool.end()]) } }
}
export type AgentRuntime = ReturnType<typeof initialize>
let nodeRuntime: AgentRuntime | undefined

export function agentRuntime(event: H3Event): AgentRuntime {
  if (import.meta.preset === 'cloudflare-module' || import.meta.preset === 'cloudflare-pages') {
    // Hyperdrive sockets belong to one Worker invocation.
    if (!event.context.feedlogAgentRuntime) {
      const binding = (globalThis as typeof globalThis & { __env__?: { POSTGRES?: { connectionString: string } }; POSTGRES?: { connectionString: string } }).__env__?.POSTGRES || (globalThis as typeof globalThis & { POSTGRES?: { connectionString: string } }).POSTGRES
      if (!binding) throw new Error('POSTGRES Hyperdrive binding not found')
      event.context.feedlogAgentRuntime = initialize(binding.connectionString, true)
    }
    return event.context.feedlogAgentRuntime
  }
  return nodeRuntime ??= initialize(process.env.DATABASE_URL!)
}

export async function withAgentRuntime<T>(event: H3Event, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  finally {
    if (event.context.feedlogAgentRuntime) {
      const runtime = event.context.feedlogAgentRuntime as AgentRuntime
      event.waitUntil(Promise.resolve(event.context.feedlogAgentTask).finally(() => runtime.close()))
    }
  }
}

export function agentError(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, message, data: { code } })
}
export async function widgetActor(event: H3Event) {
  const { session, orgId } = await requireAuthInOrg(event)
  const { pool } = agentRuntime(event)
  const { rows: [settings] } = await pool.query('SELECT enabled,conversation_retention_days FROM organization_widget WHERE org_id=$1', [orgId])
  if (settings?.enabled === false) agentError(403, 'widget_disabled', 'Widget is not enabled')
  return { session, orgId, customerId: session.user.id, retentionDays: settings?.conversation_retention_days ?? CONVERSATION_RETENTION_DEFAULT_DAYS }
}
export type Actor = Awaited<ReturnType<typeof widgetActor>>

export async function transaction<T>(runtime: AgentRuntime, fn: (client: PoolClient) => Promise<T>, repeatableRead = false): Promise<T> {
  const client = await runtime.pool.connect()
  try {
    await client.query(repeatableRead ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN')
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function expireRuns(client: Pick<PoolClient, 'query'>, id: string) {
  await client.query("UPDATE agent_run SET status='failed',error='Execution timed out. Please retry.',finished_at=clock_timestamp() WHERE conversation_id=$1 AND status='running' AND deadline_at<=clock_timestamp()", [id])
}
export async function lockConversation(client: PoolClient, id: string, actor: Actor, allowEmpty = false) {
  const { rows: [row] } = await client.query(`SELECT * FROM conversation WHERE id=$1 AND org_id=$2 AND user_id=$3
    AND last_message_at > now()-make_interval(days=>$4) AND (last_seq>0 OR $5) FOR UPDATE`, [id, actor.orgId, actor.customerId, actor.retentionDays, allowEmpty])
  if (!row) agentError(404, 'conversation_not_found', 'Conversation not found')
  await expireRuns(client, id)
  return row
}
export async function appendItem(client: PoolClient, input: { id: string; conversationId: string; author: 'customer' | 'agent'; userId?: string; content: Content; context?: PageContext | null; runId?: string }) {
  const preview = stripMarkdown(input.content.parts.map(part => part.type === 'text' ? part.text : 'title' in part ? part.title : '').join(' ')).slice(0, 200) || 'Image'
  const { rows: [row] } = await client.query(`UPDATE conversation SET last_seq=last_seq+1,last_message_at=now(),
    preview_text=$3::text,title=coalesce(title,$3::text),unread=CASE WHEN $2 THEN true ELSE unread END WHERE id=$1 RETURNING last_seq`, [input.conversationId, input.author === 'agent', preview])
  const { rows: [item] } = await client.query(`INSERT INTO conversation_item (id,conversation_id,seq,author_type,author_user_id,content,context,agent_run_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [input.id, input.conversationId, row.last_seq, input.author, input.userId ?? null, JSON.stringify(input.content), input.context ? JSON.stringify(input.context) : null, input.runId ?? null])
  return item
}
export function publicItem(item: Record<string, unknown>) {
  return { id: item.id, seq: Number(item.seq), authorType: item.author_type, content: item.content, context: item.context, agentRunId: item.agent_run_id, createdAt: item.created_at }
}
export function publicRun(run: Record<string, unknown>) {
  return { id: run.id, triggerItemId: run.trigger_item_id, status: run.status, error: run.error, startedAt: run.started_at, deadlineAt: run.deadline_at, finishedAt: run.finished_at }
}
