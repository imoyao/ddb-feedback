// The guard runs here, not in a middleware, because it needs the same Request
// object better-auth is about to handle: it reads the body via clone(), and a
// second Request off the event would consume the only readable copy on Workers.
export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)
  // Answers exactly as better-auth does when signed out, so the client can't
  // tell the two apart.
  if (await guardSsoAuthRequest(event, request)) return null
  return auth.handler(request)
})
