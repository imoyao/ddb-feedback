import { and, eq } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'
import { updateHelpArticleSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })

  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, updateHelpArticleSchema.parse)

  const db = useDB()
  const scope = and(eq(helpArticle.id, id), eq(helpArticle.orgId, orgId))

  const [existing] = await db
    .select({
      status: helpArticle.status,
      title: helpArticle.title,
      description: helpArticle.description,
      content: helpArticle.content,
      publishedAt: helpArticle.publishedAt,
      collectionId: helpArticle.collectionId,
    })
    .from(helpArticle)
    .where(scope)
    .limit(1)

  if (!existing) {
    throw createError({ statusCode: 404, message: 'Article not found' })
  }

  const title = body.title ?? existing.title
  const description = body.description === undefined ? existing.description : body.description
  const content = body.content ?? existing.content
  const contentChanged = title !== existing.title || description !== existing.description || content !== existing.content

  const updates: Record<string, unknown> = {}
  if (body.aiEnabled !== undefined) updates.aiEnabled = body.aiEnabled

  if (body.collectionId && body.collectionId !== existing.collectionId) {
    const [collection] = await db
      .select({ id: helpCollection.id })
      .from(helpCollection)
      .where(and(eq(helpCollection.id, body.collectionId), eq(helpCollection.orgId, orgId)))
      .limit(1)

    if (!collection) {
      throw createError({ statusCode: 404, message: 'Collection not found' })
    }

    updates.collectionId = body.collectionId
    updates.position = await nextHelpArticlePosition(body.collectionId)
  }

  if (contentChanged) {
    updates.title = title
    updates.description = description
    updates.content = content
    updates.tsv = buildHelpTsv(title, description, content)
    updates.updatedAt = new Date()
    if (title !== existing.title) updates.slug = generateHelpSlug(title)
  }

  const status = body.status ?? (existing.status === 'archived' && contentChanged ? 'draft' : undefined)

  if (status === 'published') {
    if (!title.trim()) {
      throw createError({ statusCode: 400, message: 'Title is required to publish' })
    }
    updates.status = 'published'
    if (!existing.publishedAt) updates.publishedAt = new Date()
  }
  else if (status === 'archived') {
    if (existing.status !== 'published') {
      throw createError({ statusCode: 409, message: 'Only a published article can be unpublished' })
    }
    updates.status = 'archived'
  }
  else if (status) {
    updates.status = status
  }

  if (Object.keys(updates).length) {
    await db.update(helpArticle).set(updates).where(scope)
  }

  return await findHelpArticleDetail(orgId, id)
})
