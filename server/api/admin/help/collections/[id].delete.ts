import { and, eq } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })

  const id = getRouterParam(event, 'id')!
  const db = useDB()

  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(helpCollection)
      .where(and(eq(helpCollection.id, id), eq(helpCollection.orgId, orgId)))
      .returning({ id: helpCollection.id })

    if (!deleted) {
      throw createError({ statusCode: 404, message: 'Collection not found' })
    }

    await tx
      .delete(helpArticle)
      .where(and(eq(helpArticle.collectionId, id), eq(helpArticle.orgId, orgId)))
  })

  setResponseStatus(event, 204)
  return null
})
