<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">{{ t('dashboard.hello', { name: firstName }) }}</h1>
      <p class="mt-1 text-ink-soft">{{ t('dashboard.lead') }}</p>
    </div>

    <!-- Main panel: one brand panel per screen -->
    <section class="panel-brand flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
      <div class="flex-1">
        <span class="eyebrow !text-sun-soft">{{ t('dashboard.continueEyebrow') }}</span>
        <h2 class="mt-2 text-xl font-extrabold sm:text-2xl">{{ t('dashboard.continueTitle') }}</h2>
        <p class="mt-2 text-white/85">{{ t('dashboard.continueText') }}</p>
        <div v-if="d" class="mt-4 max-w-sm">
          <div class="mb-1.5 flex justify-between text-xs font-semibold text-white/85">
            <span>{{ t('dashboard.levelShort', { n: d.level }) }} · {{ d.title[lang] }}</span>
            <span>{{ d.xp }} / {{ d.levelProgress.to }} XP</span>
          </div>
          <ProgressBar :value="levelPercent" color="var(--sun)" track="var(--on-dark-a20)" :label="t('dashboard.levelProgress')" />
        </div>
      </div>
      <button class="btn btn-sun self-start sm:self-center" :disabled="starting" @click="go">
        {{ starting ? t('common.loading') : t('dashboard.start') }} <Icon name="arrowRight" :size="18" />
      </button>
    </section>
    <p v-if="startError" class="rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-dark">{{ startError }}</p>

    <!-- PRD 7.5: three tasks of the day -->
    <section v-if="daily.tasks.length" class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('daily.title') }}</h2>
        <span class="chip chip-brand"><Icon name="bolt" :size="13" /> {{ t('daily.bonus', { n: daily.bonusXp }) }}</span>
      </div>
      <ul class="mt-3 grid gap-3 md:grid-cols-3">
        <li v-for="task in daily.tasks" :key="task.index" class="flex flex-col rounded-xl border p-4" :class="task.done ? 'border-ok/40 bg-ok-soft' : 'border-line'">
          <span class="eyebrow">{{ t(`daily.kinds.${task.kind}`) }}</span>
          <span class="mt-2 font-semibold">{{ task.title }}</span>
          <span class="mt-1 text-xs text-ink-mute">{{ task.skillName || t(`modes.${task.mode}.title`) }} · {{ t('train.difficulty', { n: task.difficulty }) }}</span>
          <div class="mt-auto pt-3">
            <span v-if="task.done" class="chip chip-ok"><Icon name="check" :size="13" /> {{ t('daily.done') }}</span>
            <button v-else class="btn btn-ghost !min-h-9 text-sm" :disabled="busyDaily === task.index" @click="openDaily(task.index)">
              {{ task.instanceId ? t('dashboard.open') : t('train.start') }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- STD-1: assignments from the teacher -->
    <section v-if="assignments.length" class="card p-5">
      <h2 class="text-lg font-bold">{{ t('dashboard.assigned') }}</h2>
      <div v-for="a in assignments" :key="a.id" class="mt-4 rounded-xl border border-line p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-bold">{{ a.title }}</span>
          <span class="chip" :class="a.kind === 'exam' ? 'chip-warn' : 'chip-outline'">{{ t(`dashboard.kind.${a.kind}`) }}</span>
          <span class="chip chip-outline">{{ a.groupName }}</span>
          <span class="ml-auto text-xs font-semibold" :class="a.overdue ? 'text-bad-dark' : 'text-ink-mute'">{{ t('dashboard.due', { date: new Date(a.dueAt).toLocaleString(locale === 'uz' ? 'uz-UZ' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) }) }}</span>
        </div>
        <ul class="mt-3 divide-y divide-line">
          <li v-for="tr in a.tracks ?? []" :key="tr.trackId" class="flex flex-wrap items-center gap-3 py-2.5">
            <Icon name="briefcase" :size="16" class="text-brand" />
            <span class="min-w-0 flex-1 text-sm font-semibold">{{ tr.title }}</span>
            <span class="chip chip-outline">{{ t('train.stagesCount', { n: tr.stagesCount }) }}</span>
            <span v-if="tr.finalScore != null" class="chip chip-ok">{{ tr.finalScore }} / 100</span>
            <button v-if="tr.runId || !a.overdue" class="btn btn-ghost !min-h-9 text-sm" :disabled="busyTask === tr.trackId" @click="openAssignedTrack(a.id, tr.trackId)">
              {{ tr.runId ? t('dashboard.open') : t('train.start') }}
            </button>
          </li>
          <li v-for="task in a.tasks" :key="task.templateId" class="flex flex-wrap items-center gap-3 py-2.5">
            <span class="min-w-0 flex-1 text-sm font-semibold">{{ task.title }}</span>
            <span class="chip chip-outline">{{ t(`taskTypes.${task.taskType}`) }}</span>
            <span v-if="task.bestScore != null" class="chip chip-ok">{{ task.bestScore }} / 100</span>
            <button v-if="task.instanceId || !a.overdue" class="btn btn-ghost !min-h-9 text-sm" :disabled="busyTask === task.templateId" @click="openAssigned(a.id, task.templateId)">
              {{ task.instanceId ? t('dashboard.open') : t('train.start') }}
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <component :is="s.to ? 'RouterLink' : 'div'" v-for="s in tiles" :key="s.label" :to="s.to" class="card p-4" :class="s.to ? 'hover:border-brand/40' : ''">
        <div class="flex items-center gap-2 text-xs font-semibold text-ink-mute">
          <Icon :name="s.icon" :size="16" :class="s.color" /> {{ s.label }}
        </div>
        <div class="mt-2 text-2xl font-extrabold">{{ s.value }}</div>
      </component>
    </section>

    <section class="card p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">{{ t('dashboard.recent') }}</h2>
        <RouterLink to="/app/progress" class="btn btn-link">{{ t('dashboard.allHistory') }}</RouterLink>
      </div>
      <p v-if="!d?.recent.length" class="mt-3 text-sm text-ink-mute">{{ t('dashboard.noRecent') }}</p>
      <ul v-else class="mt-3 divide-y divide-line">
        <li v-for="a in d.recent" :key="a.id">
          <RouterLink :to="`/app/task/${a.instanceId}`" class="flex items-center gap-3 py-3">
            <Icon name="file" :size="18" class="text-ink-mute" />
            <span class="min-w-0 flex-1 truncate font-semibold">{{ a.title }}</span>
            <span class="text-xs text-ink-mute">{{ t('task.iterationShort', { n: a.iteration }) }}</span>
            <StatusChip :status="a.status" :score="a.finalScore" />
          </RouterLink>
        </li>
      </ul>
    </section>

    <form class="card flex flex-wrap items-end gap-3 p-5" @submit.prevent="join">
      <div class="min-w-[200px] flex-1">
        <label class="label" for="join">{{ t('dashboard.joinGroup') }}</label>
        <input id="join" v-model.trim="inviteCode" class="input uppercase placeholder:normal-case" :placeholder="t('dashboard.joinHint')" />
      </div>
      <button class="btn btn-ghost" :disabled="inviteCode.length < 4">{{ t('dashboard.join') }}</button>
      <p v-if="groups.length" class="w-full text-xs text-ink-mute">{{ t('dashboard.myGroups') }}: {{ groups.map(g => g.name).join(', ') }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import StatusChip from '@/components/ui/StatusChip.vue'
import { useAuthStore } from '@/stores/auth'
import { useStatsStore } from '@/stores/stats'
import { startTask, withGenerating } from '@/utils/tasks'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const stats = useStatsStore()
stats.refresh().catch(() => {})

const d = computed(() => stats.dashboard)
const lang = computed(() => locale.value as 'ru' | 'uz')
const firstName = computed(() => (auth.user?.fullName || '').split(/\s+/)[1] || (auth.user?.fullName || '').split(/\s+/)[0] || '')
const levelPercent = computed(() => {
  if (!d.value) return 0
  const { from, to } = d.value.levelProgress
  return to > from ? ((d.value.xp - from) / (to - from)) * 100 : 0
})
const tiles = computed(() => [
  { icon: 'flame', color: 'text-warn', label: t('dashboard.streak'), value: t('dashboard.days', { n: d.value?.streak.current ?? 0 }) },
  { icon: 'bolt', color: 'text-brand', label: 'XP', value: d.value?.xp ?? 0 },
  { icon: 'check', color: 'text-ok', label: t('dashboard.solved'), value: d.value?.solved ?? 0 },
  { icon: 'trophy', color: 'text-ok', label: t('dashboard.achievements'), value: d.value?.achievements ?? 0, to: '/app/progress#achievements' }
])

const starting = ref(false)
const startError = ref('')
// The main button opens the first unfinished task of the day, otherwise an adaptive task of any mode
async function go() {
  const open = daily.value.tasks.find(x => !x.done)
  if (open) { await openDaily(open.index); return }
  starting.value = true
  startError.value = ''
  const code = await startTask(router, {})
  if (code) startError.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  starting.value = false
}

const daily = ref<{ bonusXp: number; tasks: any[] }>({ bonusXp: 15, tasks: [] })
const busyDaily = ref<number | null>(null)
async function openDaily(index: number) {
  busyDaily.value = index
  try {
    const { data } = await apiClient.post(`/me/daily/${index}/start`)
    router.push({ name: 'Task', params: { id: data.instance.id } })
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    busyDaily.value = null
  }
}
onMounted(() => { apiClient.get('/me/daily').then(r => { daily.value = r.data }).catch(() => {}) })

// Assignments and groups of the student
const assignments = ref<any[]>([])
const groups = ref<{ id: string; name: string }[]>([])
const inviteCode = ref('')
const busyTask = ref<string | null>(null)
async function loadAssignments() {
  const { data } = await apiClient.get('/me/assignments')
  assignments.value = data.assignments
  groups.value = data.groups
}
onMounted(() => { loadAssignments().catch(() => {}) })

async function openAssigned(assignmentId: string, templateId: string) {
  busyTask.value = templateId
  try {
    const { data } = await withGenerating(() => apiClient.post(`/tasks/from-assignment/${assignmentId}/${templateId}`))
    router.push({ name: 'Task', params: { id: data.instance.id } })
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    busyTask.value = null
  }
}

async function openAssignedTrack(assignmentId: string, trackId: string) {
  busyTask.value = trackId
  try {
    const { data } = await apiClient.post(`/tracks/${trackId}/start`, { assignmentId })
    router.push({ name: 'CaseRun', params: { id: data.run.id } })
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    busyTask.value = null
  }
}

async function join() {
  try {
    const { data } = await apiClient.post('/me/groups/join', { inviteCode: inviteCode.value })
    toast(t('dashboard.joined', { name: data.group.name }), 'ok')
    inviteCode.value = ''
    loadAssignments()
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  }
}
</script>
