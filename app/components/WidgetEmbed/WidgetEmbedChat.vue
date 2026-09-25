<script setup lang="ts">
import type { ChatInput, Detail, Item, Run } from '#layers/feedlog/shared/agent/content'
import { readAgentEvents } from '#layers/feedlog/shared/agent/sse'
import { resolveAttachmentUrl } from '#layers/feedlog/app/utils/attachment'
import { widgetEmbedKey } from '#layers/feedlog/app/composables/useWidgetEmbed'
import { widgetProtocolKey } from '#layers/feedlog/app/composables/useWidgetProtocol'


const props = defineProps<{
  productName: string; openId: string | null
}>()
const emit = defineEmits<{ authRequired: []; filed: []; replied: [id: string, lastSeq: number]; started: [id: string]; busy: [value: boolean] }>()
const { t } = useI18n()
const { user, widgetFetch, widgetRequest, ensureIdentity } = inject(widgetEmbedKey)!
const protocol = inject(widgetProtocolKey, null)
const apiBase = '/api/widget/conversations'
const conversationId = ref<string | null>(null)
const items = ref<Item[]>([])
const runs = ref<Run[]>([])
const nextBeforeSeq = ref<number | null>(null)
const draft = ref('')
const sending = ref(false)
const awaitingRun = ref(false)
const loadingThread = ref(false)
const transient = ref('')
const failure = ref('')
const pending = ref<ChatInput | null>(null)
const articleSlug = ref<string | null>(null)
const observedSeq = ref(0)
const bodyEl = ref<HTMLElement | null>(null)
const draftEl = ref<HTMLTextAreaElement | null>(null)
const latestRun = computed(() => runs.value.at(-1))
const busy = computed(() => sending.value || latestRun.value?.status === 'running')
const canRetry = computed(() => !!pending.value || (items.value.at(-1)?.authorType === 'customer' && latestRun.value?.status !== 'running'))
const resumeKey = 'feedlog:widget:agent-pending'
let version = 0

function savePending() {
  try {
    if (pending.value) sessionStorage.setItem(resumeKey, JSON.stringify({ owner: user.value?.id, conversationId: conversationId.value, pending: pending.value }))
    else sessionStorage.removeItem(resumeKey)
  } catch { /* The request can still be retried while this frame remains open. */ }
}
watch(draft, () => {
  if (!draftEl.value) return
  draftEl.value.style.height = 'auto'
  draftEl.value.style.height = `${draftEl.value.scrollHeight}px`
}, { flush: 'post' })
const MAX_UPLOAD_MB = 16
interface Attachment { key: string, name: string }
const attachments = ref<Attachment[]>([])
const pendingUploads = ref(0)
const uploading = computed(() => pendingUploads.value > 0)
watch(() => busy.value || uploading.value || loadingThread.value, value => emit('busy', value), { immediate: true })
const uploadError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void uploadFiles(files)
}

function onPaste(e: ClipboardEvent) {
  const images = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'))
  if (!images.length) return
  // A copied file carries its name as text/plain; without this it lands in the draft.
  e.preventDefault()
  void uploadFiles(images)
}

async function uploadFiles(files: File[]) {
  if (!files.length || awaitingRun.value) return
  // An attachment is a write like any other, so it is enough on its own to earn
  // a guest identity.
  if (!await ensureIdentity()) {
    uploadError.value = t('widget.uploadFailed')
    return
  }
  uploadError.value = ''
  pendingUploads.value++
  for (const file of files) {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      uploadError.value = t('widget.uploadTooLarge', { size: MAX_UPLOAD_MB })
      continue
    }
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await widgetFetch<{ key: string }>('/api/upload', { method: 'POST', body: form })
      attachments.value.push({ key: res.key, name: file.name })
    }
    catch (err) {
      // Same 401 contract as send(): park before the SDK rebuilds the frame.
      if ((err as { statusCode?: number })?.statusCode === 401) {
        savePending()
        emit('authRequired')
        break
      }
      uploadError.value = t('widget.uploadFailed')
    }
  }
  pendingUploads.value--
}


function scrollToBottom() {
  nextTick(() => { if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight })
}
function onEnterKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void send()
}
async function loadHistory(older = false) {
  if (!conversationId.value) return
  const current = version
  const id = conversationId.value
  const suffix = older && nextBeforeSeq.value ? `?beforeSeq=${nextBeforeSeq.value}` : ''
  const data = await widgetFetch<Detail>(`${apiBase}/${id}/items${suffix}`)
  if (current !== version) return
  items.value = older ? [...data.items, ...items.value] : data.items
  const merged = new Map((older ? runs.value : []).map(run => [run.id, run]))
  for (const run of data.runs) merged.set(run.id, run)
  runs.value = [...merged.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  nextBeforeSeq.value = data.nextBeforeSeq

  if (!older) {
    observedSeq.value = data.conversation.lastSeq
    await nextTick()
    if (!articleSlug.value) emit('replied', id, observedSeq.value)
  }
}
async function refreshStatus() {
  failure.value = ''
  try { await loadHistory() } catch { failure.value = t('widget.loadFailed') }
}
function confirmInput(input: ChatInput) {
  if (input.action === 'send') {
    if (!items.value.some(item => item.id === input.message.id)) {
      items.value.push({ ...input.message, seq: 0, authorType: 'customer', agentRunId: null, createdAt: new Date().toISOString() })
    }
    draft.value = ''
    attachments.value = []
  }
  awaitingRun.value = false
  pending.value = null
  savePending()
  scrollToBottom()
}
async function submit(input: ChatInput) {
  if (!conversationId.value) return
  const id = conversationId.value
  const current = version
  pending.value = input
  savePending()
  sending.value = true
  awaitingRun.value = true
  failure.value = ''
  transient.value = ''
  let finished = false
  try {
    if (!await ensureIdentity()) {
      if (current === version) failure.value = t('widget.sendFailed')
      return
    }
    if (current !== version) return
    if (input.action === 'send' && !input.message.context) {
      input.message.context = await protocol!.requestPageContext()
      if (current !== version) return
    }
    savePending()
    const response = await widgetRequest(`${apiBase}/${id}/chat`, { method: 'POST', body: JSON.stringify(input) })
    if (response.headers.get('content-type')?.includes('application/json')) {
      await response.json()
      if (current !== version) return
      confirmInput(input)
      emit('started', id)
    } else {
      if (!response.body) throw new Error('Missing response stream')
      await readAgentEvents(response.body, (name, data) => {
        if (current !== version) return
        if (name === 'run') {
          confirmInput(input)
          emit('started', id)
        }
        if (name === 'text') { transient.value += data.delta; scrollToBottom() }
        if (name === 'finish') finished = true
        if (name === 'error') failure.value = data.message
      })
    }
    if (current === version) {
      if (awaitingRun.value) throw new Error('Missing run acknowledgement')
      await loadHistory()
      if (finished) emit('filed')
    }
  } catch (error) {
    if (current !== version) return
    if ((error as { statusCode?: number }).statusCode === 401) { savePending(); emit('authRequired') }
    else {
      failure.value = t('widget.sendFailed')
      await loadHistory().catch(() => {})
      if (current === version && awaitingRun.value && input.action === 'send' && items.value.some(item => item.id === input.message.id)) {
        confirmInput(input)
        emit('started', id)
      }
      // An ambiguous network failure is retried with the same request key.
    }
  } finally {
    if (current === version) {
      transient.value = ''
      sending.value = false
      awaitingRun.value = false
      scrollToBottom()
    }
  }
}
async function send() {
  const text = draft.value.trim()
  if ((!text && !attachments.value.length) || busy.value || uploading.value) return
  if (attachments.value.length + (text ? 1 : 0) > 10) { uploadError.value = t('widget.tooManyParts'); return }
  conversationId.value ??= crypto.randomUUID()
  const input: ChatInput = { action: 'send', idempotency_key: crypto.randomUUID(), message: {
    id: crypto.randomUUID(), content: { parts: [...(text ? [{ type: 'text' as const, text }] : []), ...attachments.value.map(file => ({ type: 'image' as const, storage_key: file.key }))] },
    context: null,
  } }
  const previous = pending.value
  await submit(previous?.action === 'send' && JSON.stringify(previous.message.content) === JSON.stringify(input.message.content) ? previous : input)
}
async function retry() {
  if (busy.value) return
  const last = items.value.at(-1)
  const input = pending.value ?? (last?.authorType === 'customer' ? { action: 'retry' as const, idempotency_key: crypto.randomUUID(), trigger_item_id: last.id } : null)
  if (input) await submit(input)
}
async function openConversation(id: string | null) {
  version++
  conversationId.value = id
  items.value = []
  runs.value = []
  pending.value = null
  nextBeforeSeq.value = null
  articleSlug.value = null
  transient.value = ''
  failure.value = ''
  sending.value = false
  awaitingRun.value = false
  if (!id) return
  loadingThread.value = true
  try { await loadHistory() } catch { failure.value = t('widget.loadFailed') }
  finally { loadingThread.value = false; scrollToBottom() }
}
watch(() => props.openId, id => { if (id !== conversationId.value) void openConversation(id) })
onMounted(async () => {
  let saved: { owner: string; conversationId: string; pending: ChatInput } | null = null
  try { saved = JSON.parse(sessionStorage.getItem(resumeKey) ?? 'null') } catch { /* Ignore an incomplete local draft. */ }
  if (saved?.owner === user.value?.id && !props.openId) {
    await openConversation(saved!.conversationId)
    pending.value = saved!.pending
    failure.value = t('widget.sendFailed')
    if (saved!.pending.action === 'send') {
      const message = saved!.pending.message
      if (items.value.some(item => item.id === message.id)) confirmInput(saved!.pending)
      else {
        draft.value = message.content.parts.filter(part => part.type === 'text').map(part => part.text).join('\n')
        attachments.value = message.content.parts.filter(part => part.type === 'image').map(part => ({ key: part.storage_key, name: part.storage_key }))
      }
    }
  } else await openConversation(props.openId)
})
onBeforeUnmount(() => { version++ })
onActivated(() => {
  if (conversationId.value && !busy.value && !loadingThread.value) void refreshStatus()
})
function openFeedback(slug: string) {
  protocol!.navigateToFeedback(slug)
}
function openArticle(slug: string) {
  articleSlug.value = slug
}
async function closeArticle() {
  articleSlug.value = null
  await nextTick()
  if (conversationId.value) emit('replied', conversationId.value, observedSeq.value)
}
</script>

<template>
  <WidgetEmbedArticle v-if="articleSlug" :slug="articleSlug" :product-name="productName" @close="closeArticle" @article="articleSlug = $event" />
  <div v-show="!articleSlug" ref="bodyEl" class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-background p-3.5 space-y-2.5 [overflow-wrap:anywhere]">
    <div v-if="loadingThread" class="grid place-items-center p-4"><Icon name="lucide:loader-2" size="20" class="animate-spin" /></div>
    <button v-if="nextBeforeSeq" class="block mx-auto text-xs text-primary" @click="loadHistory(true)">{{ t('widget.earlierMessages') }}</button>
    <div v-if="!items.length && !loadingThread" class="max-w-[88%] rounded-lg border bg-card px-3 py-2.5 text-[13.5px]">{{ t('widget.greeting', { product: productName }) }}</div>
    <template v-for="item in items" :key="item.id">
      <div class="flex" :class="item.authorType === 'customer' ? 'justify-end' : 'justify-start'" :data-message-id="item.id" :data-author="item.authorType">
        <div class="min-w-0 rounded-lg px-3 py-2.5 text-[13.5px] leading-normal" :class="[item.content.parts.some(part => 'feedback_id' in part) ? 'max-w-[92%]' : 'max-w-[82%]', item.authorType === 'customer' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-card border border-border rounded-bl-sm']">
          <WidgetEmbedParts :content="item.content" @feedback="openFeedback" @article="openArticle" />
        </div>
      </div>
    </template>
    <div v-if="transient" class="max-w-[82%] rounded-lg rounded-bl-sm border border-border bg-card px-3 py-2.5 text-[13.5px] leading-normal"><WidgetEmbedMarkdown :text="transient" /></div>
    <div v-else-if="busy && !awaitingRun" role="status" :aria-label="t('widget.thinking')" class="flex justify-start">
      <div class="px-3.5 py-2.5 rounded-lg rounded-bl-sm bg-card border border-border text-xs text-muted-foreground flex items-center gap-1.5">
        <span class="flex items-center gap-1" aria-hidden="true">
          <span v-for="n in 3" :key="n" class="w-1 h-1 rounded-full bg-current opacity-40 typing-dot" :style="{ animationDelay: `${(n - 1) * 0.16}s` }" />
        </span>
        {{ t('widget.thinking') }}
      </div>
    </div>
    <div v-if="failure || (!sending && latestRun?.status === 'failed')" role="status" class="text-xs text-destructive">{{ failure || latestRun?.error }}</div>
    <button v-if="canRetry && !sending" class="text-xs font-semibold text-primary" @click="retry">{{ t('widget.retryReply') }}</button>
    <button v-if="latestRun?.status === 'running' && !sending" class="text-xs text-primary" @click="refreshStatus">{{ t('widget.refreshStatus') }}</button>
  </div>
  <div v-show="!articleSlug" class="px-3 py-2.5 bg-card shrink-0">
    <p v-if="uploadError" class="mb-2 flex items-start gap-1.5 text-[11px] text-destructive">
      <Icon name="lucide:alert-circle" size="13" class="shrink-0 mt-px" />
      <span class="flex-1">{{ uploadError }}</span>
      <button
        class="shrink-0 hover:opacity-70 transition-opacity"
        :aria-label="t('widget.close')"
        @click="uploadError = ''"
      >
        <Icon name="lucide:x" size="12" />
      </button>
    </p>

    <!-- Staged attachments: already uploaded, waiting to ride along with the message. -->
    <div v-if="attachments.length || uploading" class="flex flex-wrap gap-1.5 mb-2">
      <div
        v-for="(a, i) in attachments"
        :key="a.key"
        class="relative h-12 w-16 rounded-md overflow-hidden border border-border group"
      >
        <img :src="resolveAttachmentUrl(a.key)!" :alt="a.name" class="w-full h-full object-cover">
        <button
          class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
          :aria-label="t('widget.cancel')"
          :disabled="awaitingRun"
          @click="attachments.splice(i, 1)"
        >
          <Icon name="lucide:x" size="14" />
        </button>
      </div>
      <div v-if="uploading" class="h-12 w-16 rounded-md border border-border grid place-items-center">
        <Icon name="lucide:loader-2" size="14" class="animate-spin text-muted-foreground" />
      </div>
    </div>

    <!-- Controls sit on their own row so the textarea can grow into the card
         instead of stretching the buttons beside it. -->
    <div class="rounded-md border border-border bg-card transition-shadow focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onFilePicked"
      >
      <textarea
        ref="draftEl"
        v-model="draft"
        :disabled="awaitingRun"
        rows="1"
        maxlength="4000"
        :placeholder="t('widget.placeholder')"
        class="w-full min-h-12 max-h-[120px] px-3 py-2 bg-transparent text-[13.5px] leading-normal resize-none overscroll-y-contain focus:outline-none no-scrollbar"
        @keydown.enter.exact="onEnterKey"
        @paste="onPaste"
      />
      <div class="flex items-center justify-between px-1.5 py-1">
        <button
          :disabled="uploading || busy"
          class="h-6.5 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          :aria-label="t('widget.attachImage')"
          @click="fileInput?.click()"
        >
          <Icon name="lucide:image" size="15" />
        </button>
        <button
          :disabled="(!draft.trim() && !attachments.length) || busy || uploading"
          class="relative px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[12.5px] font-heading font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          @click="send"
        >
          <span :class="{ invisible: awaitingRun }">{{ t('widget.send') }}</span>
          <span v-if="awaitingRun" class="absolute inset-0 grid place-items-center" role="status" :aria-label="t('widget.send')">
            <Icon name="lucide:loader-2" size="14" class="animate-spin" />
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
[data-author='customer'] :deep(.md-editor-preview a) {
  color: var(--primary-foreground);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
.no-scrollbar { scrollbar-width: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }
.typing-dot { animation: typing 1.2s ease-in-out infinite; }
@keyframes typing {
  0%, 60%, 100% { opacity: 0.25; }
  30% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .typing-dot { animation: none; }
}
</style>
