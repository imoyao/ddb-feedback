import { and, asc, eq } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'
import { updateHelpCollectionSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })

  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, updateHelpCollectionSchema.parse)

  const db = useDB()
  const scope = and(eq(helpCollection.id, id), eq(helpCollection.orgId, orgId))

  const [updated] = await db
    .update(helpCollection)
    .set(body)
    .where(scope)
    .returning({
      id: helpCollection.id,
      name: helpCollection.name,
      description: helpCollection.description,
      icon: helpCollection.icon,
      visible: helpCollection.visible,
      position: helpCollection.position,
    })

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Collection not found' })
  }

  const articles = await db
    .select({
      id: helpArticle.id,
      title: helpArticle.title,
      status: helpArticle.status,
      position: helpArticle.position,
      updatedAt: helpArticle.updatedAt,
    })
    .from(helpArticle)
    .where(eq(helpArticle.collectionId, id))
    .orderBy(asc(helpArticle.position), asc(helpArticle.id))

  return { ...updated, articleCount: articles.length, articles }
})
