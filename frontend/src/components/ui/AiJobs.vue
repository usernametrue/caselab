<template>
  <!-- AI drafts sent through a batch: queued ones wait for their answer, done ones link to the new draft -->
  <section v-if="jobs.length" class="card p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="font-bold">{{ t('ai.jobs.title') }}</h2>
      <span class="text-xs text-ink-mute">{{ t('ai.jobs.hint') }}</span>
    </div>
    <ul class="mt-3 flex flex-col divide-y divide-line">
      <li v-for="j in jobs" :key="j.id" class="flex flex-wrap items-center gap-3 py-2 text-sm">
        <span class="min-w-0 flex-1 truncate font-semibold">{{ j.label || t(`ai.jobs.kinds.${j.kind}`) }}</span>
        <span class="text-xs text-ink-mute">{{ new Date(j.createdAt).toLocaleString(locale === 'uz' ? 'uz-UZ' : 'ru-RU') }}</span>
        <span class="chip" :class="chipOf(j.status)">{{ t(`ai.jobs.statuses.${j.status}`) }}</span>
        <RouterLink v-if="j.status === 'done' && linkOf(j)" :to="linkOf(j)!" class="btn btn-ghost !py-1 text-sm">{{ t('ai.jobs.open') }}</RouterLink>
        <span v-if="j.status === 'failed' && j.error" class="w-full text-xs text-bad-dark">{{ j.error }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'

const props = defineProps<{ kind?: string; refreshKey?: number }>()
const { t, locale } = useI18n()
const jobs = ref<any[]>([])
let timer: ReturnType<typeof setInterval> | null = null

const PENDING = ['queued', 'submitting', 'submitted']
const chipOf = (s: string) => (s === 'done' ? 'chip-ok' : s === 'failed' ? 'chip-bad' : 'chip-muted')
function linkOf(j: any): string | null {
  const r = j.result ?? {}
  if (r.document?._id) return `/admin/documents/${r.document._id}`
  if (r.template?._id) return `/admin/templates/${r.template._id}`
  if (r.track?._id) return `/admin/tracks/${r.track._id}`
  return null
}

async function load() {
  try {
    const { data } = await apiClient.get('/admin/ai/jobs', { params: props.kind ? { kind: props.kind } : {} })
    jobs.value = data.jobs
  } catch {
    jobs.value = []
  }
  // Polled only while something waits for its batch
  const waiting = jobs.value.some(j => PENDING.includes(j.status))
  if (waiting && !timer) timer = setInterval(load, 30000)
  if (!waiting && timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(() => props.refreshKey, load)
onMounted(load)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
