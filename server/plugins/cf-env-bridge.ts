// Bridge Cloudflare Worker bindings into globalThis.__env__.
//
// == WHY THIS FILE EXISTS (upstream bug fix) ==
// Under the `cloudflare-module` preset, Nitro exposes the worker `env` (which
// holds the POSTGRES Hyperdrive binding, R2 BLOB bucket, etc.) at
// `event.context.cloudflare.env`. It is NOT available on globalThis.__env__ —
// in fact the built Nitro entry sets `globalThis._importMeta_ = { env: {} }`,
// i.e. bindings live at `globalThis._importMeta_.env`, never at
// `globalThis.__env__`. However, server/db/index.ts:25 and
// modules/cf-setup/runtime/server/utils/connection-string.ts:13 read the
// binding exclusively from `globalThis.__env__.POSTGRES`. On Cloudflare Workers
// that value is always undefined, so every request throws
// "POSTGRES Hyperdrive binding not found" (the 500 on /api/posts after deploy).
//
// == UPSTREAM SYNC NOTE ==
// This is a fork of linkcraftstudio/feedlog. The bug above exists upstream too
// (their wrangler.toml also uses `binding = "POSTGRES"` and server/db/index.ts
// reads globalThis.__env__.POSTGRES with no bridge). To keep our fix isolated
// and conflict-free when merging `upstream/main`, this fix is delivered as a
// standalone Nitro plugin rather than patching the upstream files. `git merge
// upstream/main` will not conflict with this file as long as upstream does not
// add a same-named plugin. Tracked upstream via issue:
// https://github.com/linkcraftstudio/feedlog/issues/18 (cf-env-bridge fix).
//
// == BEHAVIOR ==
// Copies the per-request env onto globalThis.__env__ on each request so the
// readers above work unchanged. globalThis is isolate-scoped on Workers and
// the env contents are identical across requests, so the write is safe. On
// non-CF presets there is no cloudflare context and this plugin is a no-op.

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const cf = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare
    if (cf?.env) {
      ;(globalThis as unknown as { __env__?: Record<string, unknown> }).__env__ = cf.env
    }
  })
})
