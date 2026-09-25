// /dashboard/* gate: any org staff (owner / manager / contributor) may enter.
// Fine-grained capability checks happen inside individual pages / API calls.
export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuthSession()

  if (!data.value?.user) {
    return navigateTo('/')
  }

  // An SSO session is not bounced: the server honours its real member role, and
  // the orgList check below still gates it — for such a session that list holds
  // only the org that minted it.
  const orgList = (data.value as { orgList?: { role: string }[] }).orgList
  if (!orgList || orgList.length === 0) {
    return navigateTo('/')
  }
})
