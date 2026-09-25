<script setup lang="ts">
import type { Content } from '#layers/feedlog/shared/agent/content'
import { ArrowUpRight, BookOpen } from 'lucide-vue-next'
import { resolveAttachmentUrl } from '#layers/feedlog/app/utils/attachment'
defineProps<{ content: Content }>()
const emit = defineEmits<{ feedback: [slug: string]; article: [slug: string] }>()
</script>

<template>
  <div class="space-y-2">
    <template v-for="(part, index) in content.parts" :key="index">
      <WidgetEmbedMarkdown v-if="part.type === 'text'" :text="part.text" />
      <a v-else-if="part.type === 'image'" :href="resolveAttachmentUrl(part.storage_key)!" target="_blank" rel="noopener noreferrer">
        <img :src="resolveAttachmentUrl(part.storage_key)!" :alt="$t('widget.attachedImage')" class="max-h-48 max-w-full rounded-lg object-contain">
      </a>
      <div v-else-if="part.type === 'article_reference'" class="space-y-1.5">
        <button v-for="article in part.articles" :key="article.article_id" :title="article.title" class="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5 text-left text-[11.5px] font-semibold text-primary hover:border-primary/50" @click="emit('article', article.slug)">
          <BookOpen class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ article.title }}</span>
          <ArrowUpRight class="size-3 shrink-0" />
        </button>
      </div>
      <WidgetEmbedFeedbackCard v-else :feedback="part" @open="emit('feedback', $event)" />
    </template>
  </div>
</template>
