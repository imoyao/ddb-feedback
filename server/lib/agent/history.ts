import type { H3Event } from 'h3'
import { z } from 'zod'
import { type Actor, agentRuntime, agentError, expireRuns, transaction, publicItem, publicRun } from '#layers/feedlog/server/lib/agent/runtime'

export async function readConversationItems(event: H3Event, actor: Actor) {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) agentError(404, 'conversation_not_found', 'Conversation not found')
  const query = z.object({ beforeSeq: z.coerce.number().int().positive().safe().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(getQuery(event))
  if (!query.success) agentError(422, 'invalid_message', 'Invalid page parameters')
  const runtime = agentRuntime(event)
  // Ownership is checked before expiring a run; another tenant cannot mutate it.
  const args = [id.data, actor.orgId, actor.customerId, actor.retentionDays]
  const scope = 'id=$1 AND org_id=$2 AND user_id=$3 AND last_seq>0 AND last_message_at>now()-make_interval(days=>$4)'
  const { rowCount } = await runtime.pool.query(`SELECT id FROM conversation WHERE ${scope}`, args)
  if (!rowCount) agentError(404, 'conversation_not_found', 'Conversation not found')
  await expireRuns(runtime.pool, id.data)
  return transaction(runtime, async client => {
    const { rows: [conversation] } = await client.query(`SELECT id,title,last_seq,unread FROM conversation WHERE ${scope}`, args)
    if (!conversation) agentError(404, 'conversation_not_found', 'Conversation not found')
    const { rows } = await client.query('SELECT * FROM conversation_item WHERE conversation_id=$1 AND ($2::bigint IS NULL OR seq<$2) ORDER BY seq DESC LIMIT $3', [id.data, query.data.beforeSeq ?? null, query.data.limit + 1])
    const items = rows.slice(0, query.data.limit).reverse()
    const { rows: runs } = await client.query(`SELECT * FROM agent_run WHERE conversation_id=$1 AND (trigger_item_id=ANY($2::text[]) OR id=ANY($3::uuid[])) ORDER BY started_at,id`, [id.data, items.filter(i => i.author_type === 'customer').map(i => i.id), items.filter(i => i.agent_run_id).map(i => i.agent_run_id)])
    return { conversation: { id: conversation.id, title: conversation.title, lastSeq: Number(conversation.last_seq), unread: conversation.unread }, items: items.map(publicItem), runs: runs.map(publicRun), nextBeforeSeq: rows.length > query.data.limit ? Number(items[0].seq) : null }
  }, true)
}
