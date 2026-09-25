<script setup lang="ts">
interface SearchHit {
  shortId: string
  slug: string
  title: string
  titleRanges: [number, number][]
  excerpt: string
  excerptRanges: [number, number][]
  collection: { id: string; name: string }
}

const props = defineProps<{ query: string }>()

const localePath = useLocalePath()

const hits = ref<SearchHit[]>([])
const total = ref(0)
const rateLimited = ref(false)
const loading = ref(false)

let timer: ReturnType<typeof setTimeout>
let seq = 0

watch(() => props.query, (value) => {
  clearTimeout(timer)
  loading.value = true
  const q = value.trim()
  timer = setTimeout(async () => {
    const mine = ++seq
    try {
      const result = await $fetch<{ total: number; data: SearchHit[] }>('/api/help/search', { query: { q } })
      if (mine !== seq) return
      hits.value = result.data
      total.value = result.total
      rateLimited.value = false
    }
    catch (e) {
      if (mine !== seq) return
      hits.value = []
      total.value = 0
      rateLimited.value = (e as { statusCode?: number; response?: { status?: number } }).statusCode === 429
        || (e as { response?: { status?: number } }).response?.status === 429
    }
    finally {
      if (mine === seq) loading.value = false
    }
  }, 200)
}, { immediate: true })

function segments(text: string, ranges: [number, number][]) {
  const out: { text: string; hit: boolean }[] = []
  let cursor = 0
  for (const [from, to] of ranges) {
    if (from > cursor) out.push({ text: text.slice(cursor, from), hit: false })
    out.push({ text: text.slice(from, to), hit: true })
    cursor = to
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
  return out
}
</script>

<template>
  <div class="absolute inset-x-0 top-[60px] z-20 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_20px_rgba(196,90,70,.08)]">
    <template v-if="hits.length">
      <p class="border-b border-border px-[18px] py-2.5 text-[11px] font-bold uppercase tracking-[.05em] text-muted-foreground">
        {{ $t('help.portal.results', { n: total }, total) }}
      </p>
      <NuxtLink
        v-for="hit in hits"
        :key="hit.shortId"
        :to="localePath(`/help/${hit.shortId}-${hit.slug}`)"
        class="group block cursor-pointer border-b border-border px-[18px] py-3 hover:bg-background"
      >
        <div class="text-sm font-bold leading-5 group-hover:text-primary">
          <span v-for="(part, i) in segments(hit.title, hit.titleRanges)" :key="i" :class="part.hit && 'rounded-sm bg-primary/10 px-0.5 font-bold text-primary'">{{ part.text }}</span>
        </div>
        <div class="mt-1 line-clamp-2 text-xs leading-[18px] text-muted-foreground">
          <span v-for="(part, i) in segments(hit.excerpt, hit.excerptRanges)" :key="i" :class="part.hit && 'rounded-sm bg-primary/10 px-0.5 font-bold text-primary'">{{ part.text }}</span>
        </div>
        <div class="mt-[7px] flex items-center gap-[5px] text-[11px] font-bold leading-[15px] text-primary">
          <Icon name="lucide:book-open" size="12" />
          {{ hit.collection.name }}
        </div>
      </NuxtLink>
      <p v-if="total > hits.length" class="px-[18px] pb-3 pt-2.5 text-center text-[11px] leading-4 text-muted-foreground">
        {{ $t('help.portal.more', { n: total - hits.length }) }}
      </p>
    </template>

    <div v-else-if="loading" class="flex justify-center px-[18px] py-7">
      <Icon name="lucide:loader-2" size="20" class="animate-spin text-muted-foreground" />
    </div>

    <div v-else class="px-[18px] py-7 text-center">
      <div class="text-sm font-semibold">{{ rateLimited ? $t('help.portal.rateLimited') : $t('help.portal.noMatch') }}</div>
      <div class="mt-1 text-xs leading-[18px] text-muted-foreground">
        {{ rateLimited ? $t('help.portal.rateLimitedHint') : $t('help.portal.noMatchHint') }}
      </div>
    </div>
  </div>
</template>
