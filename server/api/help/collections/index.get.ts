import { and, asc, eq, sql } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

export default defineEventHandler(async (event) => {
  const orgId = await requireHelpCenterOrg(event)
  const db = useDB()

  const data = await db
    .select({
      id: helpCollection.id,
      name: helpCollection.name,
      description: helpCollection.description,
      icon: helpCollection.icon,
      articleCount: sql<number>`cast(count(${helpArticle.id}) as int)`,
    })
    .from(helpCollection)
    .innerJoin(helpArticle, and(
      eq(helpArticle.collectionId, helpCollection.id),
      eq(helpArticle.status, 'published'),
    ))
    .where(and(eq(helpCollection.orgId, orgId), eq(helpCollection.visible, true)))
    .groupBy(helpCollection.id, helpCollection.position)
    .orderBy(asc(helpCollection.position), asc(helpCollection.id))

  return { data }
})
