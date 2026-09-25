import { z } from 'zod'
import { widgetActor, agentRuntime, withAgentRuntime, agentError } from '#layers/feedlog/server/lib/agent/runtime'
import { countWidgetBadge } from '#layers/feedlog/server/utils/widget-unread'

export default defineEventHandler(event => withAgentRuntime(event, async () => {
  const actor = await widgetActor(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) agentError(404, 'conversation_not_found', 'Conversation not found')
  const body = z.object({ observed_last_seq: z.number().int().positive().safe() }).strict().safeParse(await readBody(event).catch(() => null))
  if (!body.success) agentError(422, 'invalid_message', 'The displayed message sequence is required')
  const { rows: [row] } = await agentRuntime(event).pool.query(`UPDATE conversation SET unread=CASE WHEN last_seq=$5 THEN false ELSE unread END
    WHERE id=$1 AND org_id=$2 AND user_id=$3 AND last_seq>0 AND last_message_at>now()-make_interval(days=>$4)
    RETURNING last_seq=$5 AS cleared`, [id.data, actor.orgId, actor.customerId, actor.retentionDays, body.data.observed_last_seq])
  if (!row) agentError(404, 'conversation_not_found', 'Conversation not found')
  return { cleared: row.cleared, ...await countWidgetBadge(actor.orgId, actor.customerId) }
}))
