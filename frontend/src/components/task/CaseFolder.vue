<template>
  <div class="card p-5">
    <div class="flex items-center justify-between gap-2">
      <span class="eyebrow">{{ t('caseRun.folder') }}</span>
      <span class="chip chip-outline">{{ docs.length }}</span>
    </div>
    <p v-if="!docs.length" class="mt-3 text-sm text-ink-mute">{{ t('caseRun.folderEmpty') }}</p>
    <ul class="mt-3 flex flex-col gap-2">
      <li v-for="(d, i) in ordered" :key="i" class="rounded-xl border border-line">
        <button type="button" class="flex w-full items-start gap-2 p-3 text-left" :aria-expanded="openIndex === i" @click="openIndex = openIndex === i ? null : i">
          <span class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" :class="kindClass[d.kind]"><Icon :name="kindIcon[d.kind]" :size="15" /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ d.title }}</span>
            <span class="block text-xs text-ink-mute">{{ t(`caseRun.kinds.${d.kind}`) }}<template v-if="d.date"> · {{ ruDate(d.date) }}</template><template v-if="d.generatedByAi"> · {{ t('caseRun.ai') }}</template></span>
          </span>
          <Icon name="arrowRight" :size="15" class="mt-1 text-ink-mute transition-transform" :class="openIndex === i ? 'rotate-90' : ''" />
        </button>
        <div v-if="openIndex === i" class="doc-text border-t border-line p-3 text-sm">{{ d.text }}</div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

export interface FolderDoc { kind: 'case' | 'student' | 'court' | 'opponent'; title: string; text: string; date: string; generatedByAi?: boolean }

const props = defineProps<{ docs: FolderDoc[] }>()
const { t } = useI18n()
// The newest document first: it is usually what the current stage is about
const ordered = computed(() => [...props.docs].reverse())
const openIndex = ref<number | null>(0)
const kindIcon: Record<string, string> = { case: 'file', student: 'pen', court: 'scale', opponent: 'users' }
const kindClass: Record<string, string> = { case: 'bg-paper text-ink-soft', student: 'bg-brand-soft text-brand-dark', court: 'bg-warn-soft text-warn-dark', opponent: 'bg-bad-soft text-bad-dark' }
const ruDate = (s: string) => s.split('-').reverse().join('.')
</script>
