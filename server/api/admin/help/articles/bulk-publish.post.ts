import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { helpArticle } from '#layers/feedlog/server/db/schemas'
import { bulkHelpArticleSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, bulkHelpArticleSchema.parse)

  const db = useDB()

  const affected = await db
    .update(helpArticle)
    .set({ status: 'published', publishedAt: sql`coalesce(${helpArticle.publishedAt}, now())` })
    .where(and(
      eq(helpArticle.orgId, orgId),
      inArray(helpArticle.id, body.ids),
      ne(helpArticle.status, 'published'),
    ))
    .returning({ id: helpArticle.id })

  return { affected: affected.length, skipped: body.ids.length - affected.length }
})
