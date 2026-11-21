<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">{{ t('train.title') }}</h1>
      <p class="mt-1 text-ink-soft">{{ t('train.lead') }}</p>
    </div>

    <section class="grid gap-3 sm:grid-cols-2">
      <div v-for="m in modes" :key="m.mode" class="card flex flex-col p-5" :class="{ 'lift': m.count > 0 }">
        <div class="flex items-start gap-3">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl" :class="m.bg"><Icon :name="m.icon" :size="22" class="wiggle" /></span>
          <div class="min-w-0 flex-1">
            <h2 class="font-bold">{{ t(`modes.${m.mode}.title`) }}</h2>
            <p class="mt-1 text-sm text-ink-soft">{{ t(`modes.${m.mode}.text`) }}</p>
          </div>
        </div>
        <div class="mt-4 flex items-center justify-between gap-2">
          <span v-if="m.count > 0" class="chip chip-brand">{{ t('train.tasksCount', { n: m.count }) }}</span>
          <span v-else class="chip chip-muted">{{ m.ready ? t('train.noTasksYet') : t('train.soon') }}</span>
          <button v-if="m.count > 0" class="btn btn-primary" :disabled="busy" @click="adaptive(m.mode)">{{ t('train.startAdaptive') }}</button>
        </div>
      </div>
    </section>

    <!-- PRD 4.10: a whole case, stage by stage -->
    <section v-if="tracks.length" class="card p-5">
      <h2 class="flex items-center gap-2 text-lg font-bold"><Icon name="briefcase" :size="20" class="text-brand" /> {{ t('train.tracks') }}</h2>
      <p class="mt-1 text-sm text-ink-soft">{{ t('train.tracksLead') }}</p>
      <ul class="mt-3 divide-y divide-line">
        <li v-for="tr in tracks" :key="tr.id" class="flex flex-wrap items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold">{{ tr.title }}</div>
            <p class="text-sm text-ink-soft">{{ tr.description }}</p>
          </div>
          <span class="chip chip-outline">{{ t('train.stagesCount', { n: tr.stagesCount }) }}</span>
          <span v-if="tr.run?.status === 'finished' && tr.run.finalScore != null" class="chip chip-ok">{{ tr.run.finalScore }} / 100</span>
          <button class="btn btn-ghost" :disabled="busy" @click="openTrack(tr.id)">{{ tr.run ? (tr.run.status === 'active' ? t('train.continue') : t('train.openReport')) : t('train.start') }}</button>
        </li>
      </ul>
    </section>

    <section v-if="templates.length" class="card p-5">
      <h2 class="text-lg font-bold">{{ t('train.templates') }}</h2>
      <ul class="mt-3 divide-y divide-line">
        <li v-for="tpl in templates" :key="tpl.id" class="flex flex-wrap items-center gap-3 py-3">
          <span class="min-w-0 flex-1 font-semibold">{{ tpl.title }}</span>
          <span class="chip chip-outline">{{ t(`taskTypes.${tpl.taskType}`) }}</span>
          <span class="chip chip-outline">{{ t('train.difficulty', { n: tpl.difficulty }) }}</span>
          <button class="btn btn-ghost" :disabled="busy" @click="byTemplate(tpl.id)">{{ t('train.start') }}</button>
        </li>
      </ul>
    </section>
    <p v-if="error" class="rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-dark">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { startTask } from '@/utils/tasks'

const { t, te } = useI18n()
const router = useRouter()

const counts = ref<Record<string, number>>({})
const templates = ref<{ id: string; title: string; taskType: string; difficulty: number }[]>([])
const busy = ref(false)
const error = ref('')

// Only the drafting trainer is implemented in this iteration; the rest show "in development"
// (iteration 2: document review and the procedural card are ready too)
// (iteration 3: "where to apply", the simulation, court acts and "mines" - every mode is ready)
const MODES = [
  { mode: 'draft', icon: 'pen', bg: 'bg-brand-soft text-brand', ready: true },
  { mode: 'review', icon: 'search', bg: 'bg-sky-soft text-sky-dark', ready: true },
  { mode: 'process', icon: 'scale', bg: 'bg-warn-soft text-warn-dark', ready: true },
  { mode: 'route', icon: 'route', bg: 'bg-ok-soft text-ok-dark', ready: true },
  { mode: 'sim', icon: 'chat', bg: 'bg-sun-soft text-warn-dark', ready: true }
]
const modes = computed(() => MODES.map(m => ({ ...m, count: counts.value[m.mode] ?? 0 })))

const tracks = ref<any[]>([])
onMounted(async () => {
  apiClient.get('/tracks').then(r => { tracks.value = r.data.tracks }).catch(() => {})
  const { data } = await apiClient.get('/tasks/catalog')
  counts.value = Object.fromEntries(data.modes.map((m: any) => [m.mode, m.count]))
  templates.value = data.templates
})

async function run(fn: () => Promise<string | null>) {
  busy.value = true
  error.value = ''
  const code = await fn()
  if (code) error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  busy.value = false
}
const adaptive = (mode: string) => run(() => startTask(router, { mode }))
const byTemplate = (templateId: string) => run(() => startTask(router, { templateId }))
const openTrack = (id: string) => run(async () => {
  try {
    const { data } = await apiClient.post(`/tracks/${id}/start`, {})
    await router.push({ name: 'CaseRun', params: { id: data.run.id } })
    return null
  } catch (e) { return apiErrorCode(e) }
})
</script>
