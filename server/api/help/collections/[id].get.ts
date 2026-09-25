import { and, asc, eq } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const orgId = await requireHelpCenterOrg(event)
  const id = getRouterParam(event, 'id')!

  const db = useDB()

  const [collection] = await db
    .select({
      id: helpCollection.id,
      name: helpCollection.name,
      description: helpCollection.description,
      icon: helpCollection.icon,
    })
    .from(helpCollection)
    .where(and(
      eq(helpCollection.id, id),
      eq(helpCollection.orgId, orgId),
      eq(helpCollection.visible, true),
    ))
    .limit(1)

  if (!collection) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const articles = await db
    .select({
      shortId: helpArticle.shortId,
      slug: helpArticle.slug,
      title: helpArticle.title,
      description: helpArticle.description,
      updatedAt: helpArticle.updatedAt,
    })
    .from(helpArticle)
    .where(and(eq(helpArticle.orgId, orgId), eq(helpArticle.collectionId, id), eq(helpArticle.status, 'published')))
    .orderBy(asc(helpArticle.position), asc(helpArticle.id))

  return { collection, articles }
})
