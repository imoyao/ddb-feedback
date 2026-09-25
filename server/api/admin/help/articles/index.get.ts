import { and, asc, eq, ilike, sql } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)

  const query = getQuery(event)
  const q = (query.q as string)?.trim()
  const page = Math.max(Number(query.page) || 1, 1)
  const pageSize = Math.min(Number(query.pageSize) || 10, 100)

  const db = useDB()
  const where = q
    ? and(eq(helpArticle.orgId, orgId), ilike(helpArticle.title, `%${q}%`))
    : eq(helpArticle.orgId, orgId)

  const [countResult] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(helpArticle)
    .where(where)

  const rows = await db
    .select({
      id: helpArticle.id,
      shortId: helpArticle.shortId,
      slug: helpArticle.slug,
      title: helpArticle.title,
      status: helpArticle.status,
      aiEnabled: helpArticle.aiEnabled,
      position: helpArticle.position,
      updatedAt: helpArticle.updatedAt,
      collectionId: helpCollection.id,
      collectionName: helpCollection.name,
      collectionVisible: helpCollection.visible,
    })
    .from(helpArticle)
    .innerJoin(helpCollection, eq(helpArticle.collectionId, helpCollection.id))
    .where(where)
    .orderBy(asc(helpCollection.position), asc(helpArticle.position), asc(helpArticle.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    data: rows.map(({ collectionId, collectionName, collectionVisible, ...a }) => ({
      ...a,
      collection: { id: collectionId, name: collectionName, visible: collectionVisible },
    })),
    pagination: { page, pageSize, total: countResult?.total ?? 0 },
  }
})
