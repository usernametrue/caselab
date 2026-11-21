<template>
  <div class="card p-5">
    <span class="eyebrow">{{ t('task.norms') }}</span>
    <p v-if="!norms.length" class="mt-2 text-sm text-ink-mute">{{ t('task.noNorms') }}</p>
    <details v-for="n in norms" :key="`${n.code}-${n.article}`" class="mt-3 rounded-xl border border-line p-3" :open="norms.length === 1">
      <summary class="cursor-pointer text-sm font-semibold">{{ n.code }}, {{ t('task.article') }} {{ n.article }}<span v-if="n.title" class="font-normal text-ink-soft"> - {{ n.title }}</span></summary>
      <p v-if="n.text" class="doc-text mt-2 text-sm">{{ n.text }}</p>
      <p v-else class="mt-2 text-xs text-ink-mute">{{ t('task.noNormText') }}</p>
    </details>
  </div>
  <div class="rounded-2xl border border-line bg-paper p-4 text-xs text-ink-mute">
    <span class="flex items-center gap-1.5 font-semibold"><Icon name="info" :size="14" /> {{ t('task.sourceNoteTitle') }}</span>
    <p class="mt-1">{{ t('task.sourceNote') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

// Related articles with texts from the norms dictionary and the source note (design system SourceNote)
defineProps<{ norms: { code: string; article: string; title: string; text: string }[] }>()
const { t } = useI18n()
</script>
