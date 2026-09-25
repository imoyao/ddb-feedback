export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)

  const article = await findHelpArticleDetail(orgId, getRouterParam(event, 'id')!)
  if (!article) {
    throw createError({ statusCode: 404, message: 'Article not found' })
  }

  return article
})
