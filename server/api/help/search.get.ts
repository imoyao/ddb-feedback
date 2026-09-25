import { and, asc, eq, sql } from 'drizzle-orm'
import { helpArticle, helpCollection } from '#layers/feedlog/server/db/schemas'

const SEARCH_LIMIT = 6
const RATE_LIMIT = { limit: 30, windowSeconds: 60 }

export default defineEventHandler(async (event) => {
  const orgId = await requireHelpCenterOrg(event)

  const tokens = splitHelpQuery(((getQuery(event).q as string | undefined) ?? '').trim())
  const tsQuery = buildHelpTsQuery(tokens)
  if (!tsQuery) return { total: 0, data: [] }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  if (!await checkRateLimit(`help-search:${ip}`, RATE_LIMIT)) {
    throw createError({ statusCode: 429, message: 'Too many requests' })
  }

  const db = useDB()

  const rows = await db
    .select({
      shortId: helpArticle.shortId,
      slug: helpArticle.slug,
      title: helpArticle.title,
      description: helpArticle.description,
      content: helpArticle.content,
      collectionId: helpCollection.id,
      collectionName: helpCollection.name,
      total: sql<number>`cast(count(*) over () as int)`,
    })
    .from(helpArticle)
    .innerJoin(helpCollection, eq(helpArticle.collectionId, helpCollection.id))
    .where(and(
      eq(helpArticle.orgId, orgId),
      eq(helpArticle.status, 'published'),
      eq(helpCollection.visible, true),
      sql`${helpArticle.tsv} @@ (${tsQuery})`,
    ))
    // ts_rank_cd's weight array is ordered {D,C,B,A}, so {0,0,0,1} isolates A (title) and {0,0,1,0} isolates B (description).
    .orderBy(
      sql`(case when ts_rank_cd('{0,0,0,1}', ${helpArticle.tsv}, (${tsQuery})) > 0 then 2
                when ts_rank_cd('{0,0,1,0}', ${helpArticle.tsv}, (${tsQuery})) > 0 then 1
                else 0 end) desc`,
      sql`ts_rank_cd(${helpArticle.tsv}, (${tsQuery})) desc`,
      asc(helpArticle.id),
    )
    .limit(SEARCH_LIMIT)

  return {
    total: rows[0]?.total ?? 0,
    data: rows.map((row) => {
      const { excerpt, ranges } = buildHelpExcerpt(stripMarkdown(row.content), row.description, tokens)
      return {
        shortId: row.shortId,
        slug: row.slug,
        title: row.title,
        titleRanges: helpHighlightRanges(row.title, tokens),
        excerpt,
        excerptRanges: ranges,
        collection: { id: row.collectionId, name: row.collectionName },
      }
    }),
  }
})
