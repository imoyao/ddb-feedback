import { and, eq } from 'drizzle-orm'
import { helpArticle } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })

  const id = getRouterParam(event, 'id')!
  const db = useDB()

  const [deleted] = await db
    .delete(helpArticle)
    .where(and(eq(helpArticle.id, id), eq(helpArticle.orgId, orgId)))
    .returning({ id: helpArticle.id })

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Article not found' })
  }

  setResponseStatus(event, 204)
  return null
})
