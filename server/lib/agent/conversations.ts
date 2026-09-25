import { isDeepStrictEqual } from 'node:util'
import { uuidv7 } from 'uuidv7'
import type { ChatInput } from '../../../shared/agent/content'
import { agentError, appendItem, lockConversation, transaction, type AgentRuntime, type Actor } from './runtime'

export async function startRun(runtime: AgentRuntime, id: string, actor: Actor, input: ChatInput) {
  return transaction(runtime, async client => {
    // Serializes concurrent first sends before there is a row to lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id])
    if (input.action === 'send') {
      await client.query('INSERT INTO conversation (id,org_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, actor.orgId, actor.customerId])
    }
    const conversation = await lockConversation(client, id, actor, input.action === 'send')
    if (Number(conversation.last_seq) === 0) {
      const { rowCount } = await client.query('SELECT id FROM message WHERE conversation_id=$1 LIMIT 1', [id])
      if (rowCount) agentError(404, 'conversation_not_found', 'Conversation not found')
    }
    const triggerId = input.action === 'send' ? input.message.id : input.trigger_item_id
    const { rows: [duplicate] } = await client.query('SELECT * FROM agent_run WHERE conversation_id=$1 AND idempotency_key=$2', [id, input.idempotency_key])
    const { rows: [existing] } = await client.query('SELECT * FROM conversation_item WHERE conversation_id=$1 AND id=$2', [id, triggerId])
    if (input.action === 'send' && existing && (!isDeepStrictEqual(existing.content, input.message.content) || !isDeepStrictEqual(existing.context, input.message.context))) {
      agentError(409, 'idempotency_conflict', 'Message ID belongs to different content')
    }
    if (duplicate) {
      if (duplicate.trigger_item_id !== triggerId) agentError(409, 'idempotency_conflict', 'Request key belongs to another message')
      return { run: duplicate, item: existing, duplicate: true }
    }
    const { rowCount: busy } = await client.query("SELECT id FROM agent_run WHERE conversation_id=$1 AND status='running'", [id])
    if (busy) agentError(409, 'conversation_busy', 'A reply is already in progress')
    let item = existing
    if (input.action === 'retry') {
      const { rows: [last] } = await client.query('SELECT id,author_type FROM conversation_item WHERE conversation_id=$1 ORDER BY seq DESC LIMIT 1', [id])
      const { rowCount: completed } = await client.query("SELECT id FROM agent_run WHERE trigger_item_id=$1 AND status='completed'", [triggerId])
      if (!item || last?.id !== item.id || last.author_type !== 'customer' || completed) agentError(409, 'retry_not_allowed', 'Only the latest unanswered message can be retried')
    } else {
      const { rowCount: conflict } = await client.query('SELECT id FROM conversation_item WHERE id=$1', [triggerId])
      if (conflict) agentError(409, 'idempotency_conflict', 'Message already exists; retry its execution instead')
      item = await appendItem(client, { id: triggerId, conversationId: id, author: 'customer', userId: actor.customerId, content: input.message.content, context: input.message.context })
    }
    const { rows: [run] } = await client.query("INSERT INTO agent_run (id,conversation_id,trigger_item_id,idempotency_key,deadline_at) VALUES ($1,$2,$3,$4,now()+interval '120 seconds') RETURNING *", [uuidv7(), id, triggerId, input.idempotency_key])
    return { run, item, duplicate: false }
  }).catch(error => {
    if (error.code === '23505') agentError(409, 'idempotency_conflict', 'Message ID or request key is already in use')
    throw error
  })
}
export async function failRun(runtime: AgentRuntime, runId: string, message: string) {
  await runtime.pool.query("UPDATE agent_run SET status='failed',error=$2,finished_at=now() WHERE id=$1 AND status='running'", [runId, message])
}
