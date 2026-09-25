/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures exercise partial request contexts and heterogeneous tool outputs. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { uuidv7 } from 'uuidv7'
import { createError } from 'h3'
import { chatInput, customerContent, pageContext } from '../shared/agent/content'
import { readAgentEvents } from '../shared/agent/sse'
import { agentRuntime, transaction, appendItem, expireRuns, lockConversation, type Actor } from '../server/lib/agent/runtime'
import { startRun, failRun } from '../server/lib/agent/conversations'
import { feedlogTools } from '../server/lib/agent/tools'
import { searchHelpArticles } from '../server/lib/agent/help-search'
import { loadAgentPromptContext } from '../server/lib/agent/prompts/context'
import { renderAgentSystemPrompt } from '../server/lib/agent/prompts/system'
import { isGuestSession } from '../server/utils/guest'
import { stripMarkdown } from '../shared/utils/markdown'

const event = { waitUntil: (task: Promise<unknown>) => task, path: '/', context: {}, node: { req: { headers: { host: 'example.localhost:3000' }, url: '/' } } } as any
const runtime = agentRuntime(event)
const { pool, memory } = runtime
const url = new URL(process.env.DATABASE_URL!)
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Integration tests require a local database')
after(() => runtime.close())
Object.assign(globalThis, { createError, stripMarkdown, isGuestSession, assertGuestMay: async () => {}, generatePostEmbedding: async () => {}, resolveEmailProvider: () => ({ name: 'console' }), createDomainEvent: (input: unknown) => input, publishDomainEvent: () => {}, emitCommentNotifications: async () => {}, emitAdminNotification: async () => {} })

const send = (text = 'Test request') => chatInput.parse({ action: 'send', idempotency_key: uuidv7(), message: { id: `msg_${uuidv7()}`, content: { parts: [{ type: 'text', text }] } } })
const rejectsCode = (fn: () => Promise<unknown>, code: string) => assert.rejects(fn, (e: any) => e.data?.code === code)
async function fixture() {
  const orgId = `agent-v1-test-${uuidv7()}`
  const userId = `agent-v1-user-${uuidv7()}`
  const otherId = `agent-v1-other-${uuidv7()}`
  await pool.query('INSERT INTO organization (id,name,slug,metadata) VALUES ($1,$2,$1,$3)', [orgId, 'Example Product', JSON.stringify({ portalModules: { helpCenter: true } })])
  for (const id of [userId, otherId]) await pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)', [id, 'Test User', `${id}@example.invalid`])
  const actor = { orgId, customerId: userId, retentionDays: 30, session: { user: { id: userId, email: `${userId}@example.invalid` } } } as Actor
  const conversationId = uuidv7()
  const cleanup = async () => {
    const { rows } = await pool.query('SELECT id FROM conversation WHERE org_id=$1', [orgId])
    for (const row of rows) {
      await pool.query('DELETE FROM mastra_messages WHERE thread_id=$1', [row.id])
      await pool.query('DELETE FROM mastra_threads WHERE id=$1', [row.id])
      await pool.query("DELETE FROM conversation_item WHERE conversation_id=$1 AND author_type='agent'", [row.id])
      await pool.query('DELETE FROM agent_run WHERE conversation_id=$1', [row.id])
      await pool.query('DELETE FROM conversation_item WHERE conversation_id=$1', [row.id])
      await pool.query('DELETE FROM message WHERE conversation_id=$1', [row.id])
    }
    for (const table of ['vote', 'comment', 'post_subscription']) await pool.query(`DELETE FROM ${table} WHERE post_id IN (SELECT id FROM post WHERE org_id=$1)`, [orgId])
    for (const table of ['post', 'board', 'help_article', 'help_collection', 'conversation']) await pool.query(`DELETE FROM ${table} WHERE org_id=$1`, [orgId])
    await pool.query('DELETE FROM organization WHERE id=$1', [orgId])
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[userId, otherId]])
  }
  return { orgId, userId, otherId, actor, conversationId, cleanup }
}

test('production inputs preserve text, constrain context and reject forged result parts', () => {
  assert.equal(customerContent.safeParse({ parts: [{ type: 'text', text: 'x'.repeat(4001) }] }).success, false)
  assert.equal(customerContent.safeParse({ parts: [{ type: 'feedback_created' }] }).success, false)
  assert.equal(pageContext.safeParse({ pathname: '//other.example/path' }).success, false)
  assert.equal(pageContext.safeParse({ pathname: '/page?secret=1' }).success, false)
  assert.equal(pageContext.safeParse({ title: 'Example' }).success, true)
  const input = send('  Preserve this text  ')
  assert.equal(input.action === 'send' && input.message.content.parts[0]?.type === 'text' && input.message.content.parts[0].text, '  Preserve this text  ')
})

test('SSE parser handles fragmented CRLF, unicode and multiple data events', async () => {
  const bytes = new TextEncoder().encode('event: text\r\ndata: {"delta":"Hello 👋"}\r\n\r\nevent: finish\ndata: {"lastSeq":2}\n\n')
  const seen: unknown[] = []
  await readAgentEvents(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close() } }), (name, data) => seen.push([name, data]))
  assert.deepEqual(seen, [['text', { delta: 'Hello 👋' }], ['finish', { lastSeq: 2 }]])
})

test('first-send concurrency, ownership, unchanged idempotency, retries, sequence and timeout fencing', async () => {
  const f = await fixture()
  try {
    const input = send()
    assert.equal(input.action, 'send')
    if (input.action !== 'send') throw new Error('Expected send')
    const attempts = await Promise.all([startRun(runtime, f.conversationId, f.actor, input), startRun(runtime, f.conversationId, f.actor, input)])
    assert.equal(attempts.filter(a => a.duplicate).length, 1)
    const first = attempts[0]!
    assert.equal(first.run.id, attempts[1]!.run.id)
    await rejectsCode(() => startRun(runtime, f.conversationId, { ...f.actor, customerId: f.otherId }, input), 'conversation_not_found')
    await rejectsCode(() => startRun(runtime, f.conversationId, { ...f.actor, orgId: 'default-org' }, input), 'conversation_not_found')
    await rejectsCode(() => startRun(runtime, f.conversationId, f.actor, { ...input, message: { ...input.message, context: { title: 'Changed' } } }), 'idempotency_conflict')
    await rejectsCode(() => startRun(runtime, f.conversationId, f.actor, send('Second input')), 'conversation_busy')
    await failRun(runtime, first.run.id, 'Test failure')
    assert.equal((await startRun(runtime, f.conversationId, f.actor, input)).run.status, 'failed')
    await rejectsCode(() => startRun(runtime, f.conversationId, f.actor, { ...input, idempotency_key: uuidv7() }), 'idempotency_conflict')
    const retry = await startRun(runtime, f.conversationId, f.actor, { action: 'retry', idempotency_key: uuidv7(), trigger_item_id: input.message.id })
    assert.notEqual(retry.run.id, first.run.id)
    await transaction(runtime, async client => {
      await lockConversation(client, f.conversationId, f.actor)
      await appendItem(client, { id: uuidv7(), conversationId: f.conversationId, author: 'agent', content: { parts: [{ type: 'text', text: 'Saved reply' }] }, runId: retry.run.id })
      await client.query("UPDATE agent_run SET status='completed',finished_at=now() WHERE id=$1", [retry.run.id])
    })
    await rejectsCode(() => startRun(runtime, f.conversationId, f.actor, { action: 'retry', idempotency_key: uuidv7(), trigger_item_id: input.message.id }), 'retry_not_allowed')
    const { rows: [conversation] } = await pool.query('SELECT last_seq,unread,title FROM conversation WHERE id=$1', [f.conversationId])
    assert.equal(Number(conversation.last_seq), 2)
    assert.equal(conversation.unread, true)
    assert.equal(conversation.title, 'Test request')
    const next = await startRun(runtime, f.conversationId, f.actor, send('New message'))
    await pool.query("UPDATE agent_run SET started_at=now()-interval '3 minutes',deadline_at=now()-interval '1 minute' WHERE id=$1", [next.run.id])
    await expireRuns(pool, f.conversationId)
    assert.equal((await pool.query('SELECT status FROM agent_run WHERE id=$1', [next.run.id])).rows[0].status, 'failed')
    const oldId = uuidv7()
    await pool.query('INSERT INTO conversation (id,org_id,user_id) VALUES ($1,$2,$3)', [oldId, f.orgId, f.userId])
    await pool.query("INSERT INTO message (id,conversation_id,role,text) VALUES ($1,$2,'user','Old history')", [uuidv7(), oldId])
    await rejectsCode(() => startRun(runtime, oldId, f.actor, send()), 'conversation_not_found')
    await pool.query('DELETE FROM message WHERE conversation_id=$1', [oldId])
  } finally { await f.cleanup() }
})

test('AI visibility is independent of publishing and public module, with no internal citations or tenant leak', async () => {
  const f = await fixture()
  try {
    const collectionId = uuidv7()
    await pool.query("INSERT INTO help_collection (id,org_id,name,icon,visible,position) VALUES ($1,$2,'Test','book-open',true,0)", [collectionId, f.orgId])
    const ids: string[] = []
    for (const [status, aiEnabled] of [['published', true], ['draft', true], ['archived', false]] as const) {
      const id = uuidv7(); ids.push(id)
      await pool.query("INSERT INTO help_article (id,org_id,collection_id,short_id,slug,status,title,content,tsv,position,ai_enabled) VALUES ($1,$2,$3,$4,'export',$5,'Report export','Export as CSV',to_tsvector('english','report export'),0,$6)", [id, f.orgId, collectionId, id.slice(-6), status, aiEnabled])
    }
    const results = await searchHelpArticles(pool, f.orgId, { queries: ['report export'] }, 'http://example.localhost:3000')
    assert.equal(results.articles.length, 2)
    assert.equal(results.articles.find(a => a.article_id === ids[1])?.url, null)
    assert.equal((await searchHelpArticles(pool, 'missing-org', { queries: ['report export'] }, 'http://example.localhost:3000')).articles.length, 0)
    const context = await loadAgentPromptContext(pool, f.actor)
    assert.deepEqual(context.articles.map(article => article.id).sort(), ids.slice(0, 2).sort())
    assert.ok(context.articles.every(article => Object.keys(article).sort().join(',') === 'description,id,title'))
    assert.doesNotMatch(renderAgentSystemPrompt(context), /Export as CSV/)
    const otherTenant = await loadAgentPromptContext(pool, { ...f.actor, orgId: 'default-org' })
    assert.ok(otherTenant.articles.every(article => !ids.includes(article.id)))
    const tools = feedlogTools(event, f.actor, f.conversationId, uuidv7(), 'input', new AbortController().signal, () => {}, context)
    const call = (name: string, input: unknown) => tools.tools[name]!.execute!(input as any, {} as any) as Promise<any>
    assert.equal((await call('read_help_article', { article_id: ids[1] })).customer_visible, false)
    assert.ok((await call('cite_help_articles', { article_ids: [ids[1]] })).error)
    await call('read_help_article', { article_id: ids[0] })
    await call('cite_help_articles', { article_ids: [ids[0]] })
    assert.equal((await tools.resultParts()).length, 1)
    await pool.query('UPDATE organization SET metadata=$2 WHERE id=$1', [f.orgId, JSON.stringify({ portalModules: { helpCenter: false } })])
    await pool.query('UPDATE help_collection SET visible=false WHERE id=$1', [collectionId])
    await pool.query('UPDATE help_article SET description=$2 WHERE id=$1', [ids[1], 'Internal "export" guide\nMore details'])
    const refreshed = await loadAgentPromptContext(pool, f.actor)
    assert.equal(refreshed.knowledgeEnabled, true)
    assert.deepEqual(refreshed.articles.map(article => article.id).sort(), ids.slice(0, 2).sort())
    const catalog = JSON.parse(renderAgentSystemPrompt(refreshed).match(/^\[\n[\s\S]*?\n\]$/m)![0])
    assert.deepEqual(catalog, refreshed.articles)
    assert.equal(catalog.find((article: { id: string }) => article.id === ids[1]).description, 'Internal "export" guide\nMore details')
    assert.equal((await tools.resultParts()).length, 0)
  } finally { await f.cleanup() }
})

test('feedback correction enforces ten-minute/community limits and falls back to owned comments; writes fence expired runs', async () => {
  const f = await fixture()
  try {
    const boardId = uuidv7()
    await pool.query("INSERT INTO board (id,org_id,name) VALUES ($1,$2,'Suggestions')", [boardId, f.orgId])
    const execution = await startRun(runtime, f.conversationId, f.actor, send())
    await memory.createThread({ threadId: f.conversationId, resourceId: `${f.orgId}:${f.conversationId}`, title: 'Test' })
    const context = await loadAgentPromptContext(pool, f.actor)
    const bundle = feedlogTools(event, f.actor, f.conversationId, execution.run.id, execution.item.id, new AbortController().signal, () => {}, context)
    const call = (name: string, input: unknown) => bundle.tools[name]!.execute!(input as any, {} as any) as Promise<any>
    const created = await call('create_feedback', { title: 'Export', content: 'I need CSV export.', board_id: boardId })
    assert.ok(created.feedback_id, JSON.stringify(created))
    assert.equal((await call('create_feedback', { title: 'Export', content: 'I need CSV export.', board_id: boardId })).feedback_id, created.feedback_id)
    const id = created.feedback_id
    const detail = await call('get_feedback', { feedback_id: id })
    assert.ok(detail.feedback, JSON.stringify(detail))
    assert.equal(detail.feedback.editable, true)
    assert.equal((await call('update_feedback', { feedback_id: id, title: 'CSV export' })).changed, true)
    assert.equal((await call('get_feedback', { feedback_id: id })).feedback.content, 'I need CSV export.')
    await pool.query('INSERT INTO vote (post_id,user_id) VALUES ($1,$2)', [id, f.otherId])
    assert.equal((await call('get_feedback', { feedback_id: id })).feedback.editable, false)
    assert.ok((await call('update_feedback', { feedback_id: id, title: 'Forbidden edit' })).error)
    await pool.query('DELETE FROM vote WHERE post_id=$1', [id])
    await pool.query("UPDATE post SET created_at=now()-interval '11 minutes' WHERE id=$1", [id])
    assert.ok((await call('update_feedback', { feedback_id: id, title: 'Too late' })).error)
    const comment = await call('add_feedback_comment', { feedback_id: id, content: 'I also need filenames.' })
    assert.ok(comment.comment_id)
    assert.equal((await call('update_feedback_comment', { comment_id: comment.comment_id, content: 'I also need dates.' })).comment_text, 'I also need dates.')
    assert.equal((await call('get_feedback', { feedback_id: id })).comments.length, 1)
    const unchanged = await call('update_feedback_comment', { comment_id: comment.comment_id, content: 'I also need dates.' })
    assert.equal(unchanged.changed, false)
    assert.equal(unchanged.type, undefined)
    await call('upvote_and_subscribe_feedback', { feedback_id: id })
    await call('upvote_and_subscribe_feedback', { feedback_id: id })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM vote WHERE post_id=$1 AND user_id=$2', [id, f.actor.customerId])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM post_subscription WHERE post_id=$1 AND user_id=$2', [id, f.actor.customerId])).rows[0].n, 1)
    const cards = (await bundle.resultParts()).filter(part => 'feedback_id' in part)
    assert.ok(cards.every(part => 'vote_count' in part && part.vote_count === 1 && part.has_voted))
    await pool.query("UPDATE agent_run SET started_at=now()-interval '3 minutes',deadline_at=now()-interval '1 minute' WHERE id=$1", [execution.run.id])
    assert.ok((await call('update_feedback_comment', { comment_id: comment.comment_id, content: 'Expired run' })).error)
    assert.equal((await pool.query('SELECT content FROM comment WHERE id=$1', [comment.comment_id])).rows[0].content, 'I also need dates.')
    await transaction(runtime, async client => {
      await client.query("UPDATE agent_run SET status='running',error=NULL,finished_at=NULL,deadline_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1", [execution.run.id])
      await client.query('SELECT pg_sleep(0.15)')
      await expireRuns(client, f.conversationId)
      assert.equal((await client.query('SELECT status FROM agent_run WHERE id=$1', [execution.run.id])).rows[0].status, 'failed')
    })
  } finally { await f.cleanup() }
})
