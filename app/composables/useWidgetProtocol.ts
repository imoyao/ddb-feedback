import type { InjectionKey } from 'vue'
import { pageContext, type PageContext } from '#layers/feedlog/shared/agent/content'

const PROTOCOL_VERSION = 1

export type WidgetOutboundType = 'ready' | 'auth-requested' | 'unread' | 'navigate' | 'close-request' | 'page-context-request'

export function useWidgetProtocol() {
  const route = useRoute()
  const embedded = ref(false)
  const supportsPageContext = ref(false)

  // targetOrigin must never be '*', so the SDK hands us the host origin on the
  // embed URL. We use it verbatim: deriving it here would break Firefox, which
  // has no location.ancestorOrigins and whose referrer the host's referrer-policy
  // may strip, leaving nothing to send to.
  //
  // A forged value buys an attacker nothing: if evil.com frames this page and
  // claims origin=acme.com, the browser sees the real parent and refuses to
  // deliver. targetOrigin stops a message going to the wrong place; it was never
  // the identity boundary — the session token is.
  const parentOrigin = computed(() => {
    const raw = route.query.origin
    return typeof raw === 'string' && raw ? raw : null
  })

  function send(type: WidgetOutboundType, payload?: Record<string, unknown>) {
    if (!embedded.value || !parentOrigin.value) return
    const message = payload === undefined
      ? { v: PROTOCOL_VERSION, type }
      : { v: PROTOCOL_VERSION, type, payload }
    window.parent.postMessage(message, parentOrigin.value)
  }

  function receiveInit(event: MessageEvent) {
    if (!embedded.value || !parentOrigin.value) return
    if (event.source !== window.parent || event.origin !== parentOrigin.value) return
    if (event.data?.v !== PROTOCOL_VERSION || event.data.type !== 'init') return
    supportsPageContext.value = event.data.payload?.capabilities?.pageContext === true
  }

  function init() {
    embedded.value = window.parent !== window
    supportsPageContext.value = false
    window.addEventListener('message', receiveInit)
  }

  onBeforeUnmount(() => window.removeEventListener('message', receiveInit))

  async function requestPageContext(): Promise<PageContext | null> {
    if (!embedded.value || !parentOrigin.value || !supportsPageContext.value) return null
    const requestId = crypto.randomUUID()
    return new Promise(resolve => {
      const finish = (context: PageContext | null) => {
        clearTimeout(timer)
        window.removeEventListener('message', receive)
        resolve(context)
      }
      const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.origin !== parentOrigin.value) return
        if (event.data?.v !== 1 || event.data.type !== 'page-context' || event.data.payload?.requestId !== requestId) return
        const parsed = pageContext.safeParse(event.data.payload.context)
        finish(parsed.success ? parsed.data : null)
      }
      // A capable host can still fail to respond; context must not block sending.
      const timer = setTimeout(() => finish(null), 500)
      window.addEventListener('message', receive)
      send('page-context-request', { requestId })
    })
  }

  return {
    embedded,
    parentOrigin,
    init,
    send,
    requestPageContext,
    ready: () => send('ready'),
    requestAuth: (reason: 'user' | 'expired') => send('auth-requested', { reason }),
    reportUnread: (count: number) => send('unread', { count }),
    navigateToFeedback: (slug: string) => {
      if (embedded.value) send('navigate', { to: 'feedback', slug })
      else window.open(`/p/${encodeURIComponent(slug)}`, '_blank', 'noopener,noreferrer')
    },
    requestClose: () => send('close-request'),
  }
}

// `embedded` is per call and starts false, making a child's send() a no-op.
export type WidgetProtocol = ReturnType<typeof useWidgetProtocol>
export const widgetProtocolKey = Symbol('widgetProtocol') as InjectionKey<WidgetProtocol>
