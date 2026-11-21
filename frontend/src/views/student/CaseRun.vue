<template>
  <div v-if="!run" class="py-20 text-center text-ink-mute">{{ loading ? t('common.loading') : t('errors.not_found') }}</div>
  <div v-else class="flex flex-col gap-5">
    <div>
      <RouterLink to="/app/train" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('nav.train') }}</RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <span class="chip chip-brand"><Icon name="briefcase" :size="13" /> {{ t('caseRun.case') }}</span>
        <span v-if="run.isExam" class="chip chip-warn">{{ t('task.exam') }}</span>
        <span class="chip chip-outline">{{ t('caseRun.caseDate', { date: ruDate(run.currentDate) }) }}</span>
      </div>
      <h1 class="mt-2 text-2xl font-extrabold tracking-tight">{{ run.title }}</h1>
      <p v-if="run.role" class="mt-1 text-ink-soft">{{ t('task.role') }}: {{ run.role }}</p>
    </div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- Current stage or the final report -->
        <section v-if="run.status === 'active'" class="panel-brand flex flex-col gap-3 p-6 sm:flex-row sm:items-center">
          <div class="flex-1">
            <span class="eyebrow !text-sun-soft">{{ t('caseRun.stageN', { n: run.visits.length }) }}</span>
            <h2 class="mt-1 text-xl font-extrabold">{{ current?.title }}</h2>
            <p class="mt-1 text-white/85">{{ run.waiting ? t('caseRun.waiting') : current?.reason ? t('caseRun.becauseOf', { reason: current.reason }) : t('caseRun.stageLead') }}</p>
          </div>
          <RouterLink v-if="!run.waiting" :to="`/app/task/${run.currentInstanceId}`" class="btn btn-sun self-start sm:self-center">{{ t('caseRun.openStage') }} <Icon name="arrowRight" :size="18" /></RouterLink>
          <button v-else class="btn btn-sun self-start sm:self-center" @click="load"><Icon name="refresh" :size="18" /> {{ t('caseRun.refresh') }}</button>
        </section>

        <section v-else class="card p-5">
          <h2 class="text-lg font-bold">{{ t('caseRun.report') }}</h2>
          <p v-if="run.awaitingPublication" class="mt-2 text-sm text-ink-soft">{{ t('result.examWaitText') }}</p>
          <template v-else>
            <div class="mt-4 flex flex-wrap items-center gap-4">
              <div class="grid h-20 w-20 place-items-center rounded-3xl text-3xl font-extrabold text-white shadow-press" :class="scoreBg">{{ run.finalScore }}</div>
              <div>
                <div class="text-xl font-extrabold" :class="run.outcome === 'win' ? 'text-ok-dark' : run.outcome === 'loss' ? 'text-bad-dark' : 'text-warn-dark'">{{ t(`caseRun.outcomes.${run.outcome}`) }}</div>
                <p class="mt-1 text-sm text-ink-soft">{{ t('caseRun.formula', { stages: stagesAvg, outcome: run.outcomeScore }) }}</p>
                <span v-if="run.xpBonus" class="chip chip-brand mt-2"><Icon name="bolt" :size="13" /> +{{ run.xpBonus }} XP {{ t('caseRun.xpBonus') }}</span>
              </div>
            </div>
            <div v-if="weakPoints.length" class="mt-5">
              <h3 class="font-bold">{{ t('caseRun.wentWrong') }}</h3>
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                <li v-for="(w, i) in weakPoints" :key="i" class="flex gap-2"><Icon name="info" :size="16" class="mt-0.5 text-warn" /> {{ w }}</li>
              </ul>
            </div>
            <button class="btn btn-ghost mt-5" :disabled="restarting" @click="restart"><Icon name="refresh" :size="17" /> {{ t('caseRun.restart') }}</button>
          </template>
        </section>

        <!-- Chronology of the case -->
        <section class="card p-5">
          <h2 class="text-lg font-bold">{{ t('caseRun.chronology') }}</h2>
          <ol class="mt-4 flex flex-col gap-0">
            <li v-for="(v, i) in run.visits" :key="i" class="relative flex gap-3 pb-5 last:pb-0">
              <span class="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold" :class="v.evaluated ? (v.setback ? 'bg-warn-soft text-warn-dark' : 'bg-ok-soft text-ok-dark') : 'bg-brand text-white'">{{ i + 1 }}</span>
              <span v-if="i < run.visits.length - 1" class="absolute left-4 top-8 h-full w-px bg-line" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <RouterLink :to="`/app/task/${v.instanceId}`" class="font-semibold hover:text-brand">{{ v.title }}</RouterLink>
                  <span class="text-xs text-ink-mute">{{ ruDate(v.date) }}</span>
                  <span v-if="v.score != null" class="chip" :class="tone(v.score)">{{ v.score }}</span>
                  <span v-if="v.setback" class="chip chip-warn">{{ t('caseRun.setback') }}</span>
                </div>
                <p v-if="v.courtAct" class="mt-1 text-sm text-ink-soft"><Icon name="scale" :size="14" class="mr-1 inline" />{{ t(`caseRun.acts.${v.courtAct}`) }}<template v-if="v.reason"> - {{ v.reason }}</template></p>
                <p v-else-if="v.reason" class="mt-1 text-sm text-ink-soft">{{ v.reason }}</p>
              </div>
            </li>
          </ol>
        </section>
      </div>

      <aside class="flex flex-col gap-4">
        <CaseFolder :docs="run.folder" />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import CaseFolder from '@/components/task/CaseFolder.vue'
import { apiClient } from '@/plugins/axios'
import { scoreTone } from '@/utils/tasks'
import { toast } from '@/components/ui/toast'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const router = useRouter()
const run = ref<any>(null)
const loading = ref(true)
let timer: ReturnType<typeof setTimeout> | null = null

async function load() {
  try {
    run.value = (await apiClient.get(`/runs/${props.id}`)).data.run
  } catch {
    run.value = null
  } finally {
    loading.value = false
  }
  // The worker moves the case after the evaluation: poll while waiting
  if (timer) clearTimeout(timer)
  if (run.value?.waiting) timer = setTimeout(load, 3000)
}
onMounted(load)
// A replay opens in the same view
watch(() => props.id, () => { loading.value = true; load() })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

const current = computed(() => run.value?.visits[run.value.visits.length - 1])
const ruDate = (s: string) => (s ? s.split('-').reverse().join('.') : '')
const tone = (s: number) => ({ ok: 'chip-ok', brand: 'chip-brand', warn: 'chip-warn', bad: 'bg-bad-soft text-bad-dark', muted: 'chip-muted' }[scoreTone(s)])
const scoreBg = computed(() => ({ ok: 'bg-ok', brand: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-ink-mute' }[scoreTone(run.value?.finalScore)]))
const stagesAvg = computed(() => {
  const done = (run.value?.visits ?? []).filter((v: any) => v.score != null)
  return done.length ? Math.round(done.reduce((a: number, v: any) => a + v.score, 0) / done.length) : 0
})
// Where the case went wrong: setback stages with their reason and weak stages
const weakPoints = computed<string[]>(() => (run.value?.visits ?? []).flatMap((v: any, i: number, all: any[]) => {
  const out: string[] = []
  if (v.setback) out.push(t('caseRun.weakSetback', { stage: v.title, reason: all[i - 1]?.reason || '-' }))
  if (v.score != null && v.score < 56) out.push(t('caseRun.weakScore', { stage: v.title, score: v.score }))
  return out
}))

const restarting = ref(false)
async function restart() {
  restarting.value = true
  try {
    const { data } = await apiClient.post(`/tracks/${run.value.trackId}/start`, { restart: true, assignmentId: run.value.assignmentId ?? undefined })
    router.push({ name: 'CaseRun', params: { id: data.run.id } })
  } catch {
    toast(t('errors.generic'), 'bad')
  } finally {
    restarting.value = false
  }
}
</script>
