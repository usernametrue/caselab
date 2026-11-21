<template>
  <span class="chip" :class="cls">
    <Icon v-if="status === 'evaluating'" name="clock" :size="13" class="pulse-soft" />
    {{ text }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import { scoreTone } from '@/utils/tasks'

const props = defineProps<{ status: string; score?: number | null }>()
const { t } = useI18n()

const cls = computed(() => {
  if (props.status === 'evaluating') return 'chip-muted'
  if (props.status === 'failed' || props.status === 'awaiting_publication') return 'chip-warn'
  const tone = scoreTone(props.score)
  return { ok: 'chip-ok', brand: 'chip-brand', warn: 'chip-warn', bad: 'bg-bad-soft text-bad-dark', muted: 'chip-muted' }[tone]
})
const text = computed(() => {
  if (props.status === 'evaluating') return t('status.evaluating')
  if (props.status === 'failed') return t('status.failed')
  if (props.status === 'awaiting_publication') return t('status.awaiting_publication')
  return props.score != null ? `${props.score} / 100` : t(`status.${props.status}`)
})
</script>
