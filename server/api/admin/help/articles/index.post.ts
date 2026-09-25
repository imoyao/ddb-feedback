import { and, eq } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'
import { createHelpArticleSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createHelpArticleSchema.parse)

  const db = useDB()

  const [collection] = await db
    .select({ id: helpCollection.id })
    .from(helpCollection)
    .where(and(eq(helpCollection.id, body.collectionId), eq(helpCollection.orgId, orgId)))
    .limit(1)

  if (!collection) {
    throw createError({ statusCode: 404, message: 'Collection not found' })
  }

  const description = body.description ?? null
  const position = await nextHelpArticlePosition(body.collectionId)

  const created = await withHelpShortId(async (shortId) => {
    const [row] = await db
      .insert(helpArticle)
      .values({
        orgId,
        collectionId: body.collectionId,
        shortId,
        slug: generateHelpSlug(body.title),
        status: body.publish ? 'published' : 'draft',
        title: body.title,
        description,
        content: body.content,
        aiEnabled: body.aiEnabled,
        tsv: buildHelpTsv(body.title, description, body.content),
        position,
        publishedAt: body.publish ? new Date() : null,
      })
      .returning({ id: helpArticle.id })

    return row!
  })

  setResponseStatus(event, 201)
  return await findHelpArticleDetail(orgId, created.id)
})
