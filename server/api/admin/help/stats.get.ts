import { eq, sql } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)
  const db = useDB()

  const [collections] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(helpCollection)
    .where(eq(helpCollection.orgId, orgId))

  const [articles] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(helpArticle)
    .where(eq(helpArticle.orgId, orgId))

  return { collectionCount: collections?.total ?? 0, articleCount: articles?.total ?? 0 }
})
