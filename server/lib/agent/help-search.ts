import type { Pool } from 'pg'
import { z } from 'zod'
import { resolvePortalModules } from '../../../shared/utils/portal-modules'
import { stripMarkdown } from '../../../shared/utils/markdown'
import { buildHelpExcerpt, splitHelpQuery } from '../../utils/help-search'

const RESULTS_PER_QUERY = 3

export const helpArticleSearchInput = z.object({
  queries: z.array(z.string().trim().min(1).max(100).describe(
    'A short English keyword query focused on one product concept or condition. All meaningful words in this query must match an article; use a few specific words, such as "report export" or "PDF format".',
  )).min(1).max(4).describe(
    'One to four short searches for the same customer question. Cover the core feature and important conditions with separate queries, or use alternative wording. For example, a question about downloading a report as PDF could use ["report export", "PDF format"]. Use one query when it is sufficient. Results from all queries are merged and deduplicated.',
  ),
}).strict()

export type HelpArticleSearchInput = z.infer<typeof helpArticleSearchInput>

export interface HelpArticleSearchResult {
  article_id: string
  slug: string
  customer_visible: boolean
  url: string | null
  title: string
  description: string | null
  excerpt: string
  matched_queries: string[]
}

export const helpArticleSearchDescription = 'Search AI-enabled knowledge articles, including internal articles using short English keyword queries for this English knowledge base. Each query independently returns up to three ranked articles; results are interleaved and deduplicated, with at most twelve articles. matched_queries lists the searches that returned each article. Use titles and excerpts to select relevant candidates, then read the full articles with read_help_article to establish product behavior.'

export async function searchHelpArticles(pool: Pick<Pool, 'query'>, orgId: string, input: HelpArticleSearchInput, origin: string) {
  const parsed = helpArticleSearchInput.parse(input)
  const { rows: [org] } = await pool.query('SELECT metadata FROM organization WHERE id=$1', [orgId])
  const publicEnabled = resolvePortalModules(org?.metadata).helpCenter
  const queries: string[] = []
  const seen = new Set<string>()
  for (const query of parsed.queries) {
    const normalized = query.replace(/\s+/g, ' ')
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(normalized)
  }

  const groups = await Promise.all(queries.map(async query => {
    const { rows } = await pool.query<{
      article_id: string
      title: string
      description: string | null
      content: string
      slug: string
      published: boolean
    }>(`SELECT a.id AS article_id,a.title,a.description,a.content,a.short_id||'-'||a.slug AS slug,(a.status='published' AND c.visible) AS published
      FROM help_article a
      JOIN help_collection c ON c.id=a.collection_id AND c.org_id=a.org_id
      WHERE a.org_id=$1 AND a.ai_enabled
        AND a.tsv @@ plainto_tsquery('english',$2)
      ORDER BY ts_rank_cd(a.tsv,plainto_tsquery('english',$2)) DESC,a.id
      LIMIT $3`, [orgId, query, RESULTS_PER_QUERY])
    return rows
  }))

  const articles = new Map<string, HelpArticleSearchResult>()
  // Interleave by rank so a broad query cannot occupy all leading positions.
  for (let rank = 0; rank < RESULTS_PER_QUERY; rank++) {
    for (const [index, group] of groups.entries()) {
      const row = group[rank]
      if (!row) continue
      const query = queries[index]!
      const existing = articles.get(row.article_id)
      if (existing) {
        existing.matched_queries.push(query)
      } else {
        const { content, published, ...article } = row
        const { excerpt } = buildHelpExcerpt(stripMarkdown(content), row.description, splitHelpQuery(query))
        articles.set(row.article_id, { ...article, excerpt, matched_queries: [query], customer_visible: publicEnabled && published, url: publicEnabled && published ? new URL(`/help/${article.slug}`, origin).href : null })
      }
    }
  }
  return { articles: [...articles.values()] }
}
