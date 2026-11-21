<template>
  <div v-if="loading" class="py-20 text-center text-ink-mute">{{ t('common.loading') }}</div>
  <div v-else-if="!instance" class="py-20 text-center text-ink-mute">{{ t('errors.not_found') }}</div>
  <div v-else class="flex flex-col gap-5">
    <div>
      <RouterLink v-if="instance.runId" :to="`/app/case/${instance.runId}`" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('caseRun.backToCase') }}</RouterLink>
      <RouterLink v-else to="/app/train" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('nav.train') }}</RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <span class="chip chip-outline">{{ t(`taskTypes.${instance.taskType}`) }}</span>
        <span class="chip chip-outline">{{ t('train.difficulty', { n: instance.difficulty }) }}</span>
        <span v-if="instance.isExam" class="chip chip-warn">{{ t('task.exam') }}</span>
        <span v-if="instance.runId" class="chip chip-brand"><Icon name="briefcase" :size="13" /> {{ t('caseRun.stage') }}</span>
        <span v-if="kind === 'draft' || kind === 'process' || kind === 'route'" class="chip chip-muted" :title="t('task.caseSourceHint')">{{ instance.content.generatedByAi ? t('task.caseAi') : t('task.caseTemplate') }}</span>
      </div>
      <h1 class="mt-2 text-2xl font-extrabold tracking-tight">{{ instance.content.title }}</h1>
    </div>

    <div class="grid gap-5" :class="wide ? 'lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,260px)]'">
      <!-- Context: case, role, today -->
      <aside class="flex flex-col gap-4">
        <div class="card p-5">
          <span class="eyebrow">{{ t('task.case') }}</span>
          <div class="mt-3 flex flex-col gap-2 text-sm">
            <div v-if="instance.content.role" class="flex gap-2"><Icon name="user" :size="16" class="mt-0.5 text-brand" /> <span><b>{{ t('task.role') }}:</b> {{ instance.content.role }}</span></div>
            <div v-if="instance.content.clientSideName" class="flex gap-2"><Icon name="shield" :size="16" class="mt-0.5 text-brand" /> <span><b>{{ t('review.client') }}:</b> {{ instance.content.clientSideName }}</span></div>
            <div class="flex gap-2"><Icon name="calendar" :size="16" class="mt-0.5 text-brand" /> <span><b>{{ t('task.today') }}:</b> {{ ruDate(instance.content.today) }}</span></div>
          </div>
          <div class="doc-text mt-4">{{ instance.content.caseText }}</div>
          <div v-if="instance.content.clientGoals" class="mt-4 rounded-xl bg-brand-tint p-3 text-sm">
            <b>{{ t('review.goals') }}:</b> {{ instance.content.clientGoals }}
          </div>
        </div>
        <div class="card p-5">
          <span class="eyebrow">{{ t('task.instructions') }}</span>
          <p class="doc-text mt-2">{{ instance.content.instructions }}</p>
        </div>
        <CaseFolder v-if="instance.runId && folder.length" :docs="folder" />
        <NormsPanel v-if="wide" :norms="norms" />
        <CalendarTool v-if="kind === 'process' || kind === 'route' || kind === 'timeline'" :today="instance.content.today" />
      </aside>

      <!-- Center: editor or result -->
      <div class="flex min-w-0 flex-col gap-4">
        <template v-if="view === 'edit'">
          <div class="flex items-center justify-between gap-2">
            <span class="eyebrow">{{ iteration === 2 ? t('task.reworkTitle') : t('task.yourWork') }}</span>
            <span v-if="kind !== 'sim' && kind !== 'hearing' && !instance.runId" class="text-xs font-semibold text-ink-mute">{{ instance.isExam ? t('task.examOneTry') : t('task.iteration', { n: iteration }) }}</span>
          </div>

          <!-- Drafting -->
          <template v-if="kind === 'draft'">
            <DocumentEditor :model-value="answers.html || answers.text" :sections="instance.content.scaffold"
              :placeholder="lockedParts ? t('task.partPlaceholder') : t('task.placeholder')"
              :locked-before="lockedParts?.[0] ?? ''" :locked-after="lockedParts?.[1] ?? ''"
              @update:model-value="v => answers.html = v" @text="v => answers.text = v" />
            <p v-if="lockedParts" class="-mt-2 text-sm text-ink-mute">{{ t('task.lockedHint') }}</p>
          </template>

          <ReviewEditor v-else-if="kind === 'review' || kind === 'act'" v-model="answers.items" :text="instance.content.documentText"
            :title="instance.content.documentTitle" :flaw-count="instance.content.flawCount" :prefix="reviewPrefix" />
          <TimelineEditor v-else-if="kind === 'timeline'" v-model="answers.timeline" :events="instance.content.timelineEvents" :checks="instance.content.timelineChecks" />
          <MinesBoard v-else-if="kind === 'mines'" v-model="answers.mines" :instance-id="instance.id" :text="instance.content.documentText"
            :title="instance.content.documentTitle" :segments="instance.content.mines.segments" :clicks="instance.content.mines.clicks"
            :flaw-count="instance.content.flawCount" :timer-sec="iteration === 1 ? instance.content.mines.timerSec : 0" :started-at="instance.content.mines.startedAt" @timeout="onTimeout" />
          <RouteTrainer v-else-if="kind === 'route'" v-model="answers.route" :instance-id="instance.id" :dialog="instance.content.clientDialog ?? []"
            :scaffold="instance.content.scaffold" @asked="e => instance.content.clientDialog = [...(instance.content.clientDialog ?? []), e]" />
          <SimPlayer v-else-if="kind === 'sim'" :instance-id="instance.id" @finished="v => simFinished = v" />
          <HearingPlayer v-else-if="kind === 'hearing'" :instance-id="instance.id" :language="instance.language" @finished="v => simFinished = v" />
          <FixCheckEditor v-else-if="kind === 'fix'" v-model="answers.decisions" :text="instance.content.documentText"
            :title="instance.content.documentTitle" :edits="instance.content.counterpartyEdits" />
          <ProcessCard v-else-if="kind === 'process'" v-model="answers.card" :courts="courts" />
          <template v-else-if="kind === 'extraction'">
            <ExtractionTable v-model="answers.extraction.cells" :documents="instance.content.extraction.documents" :fields="instance.content.extraction.fields" />
            <div class="card p-5">
              <label class="label" for="ex-notes">{{ t('extraction.notes') }}</label>
              <textarea id="ex-notes" v-model="answers.extraction.notes" rows="3" class="input text-sm" :placeholder="t('extraction.notesHint')" />
            </div>
          </template>

          <div class="flex flex-wrap items-center justify-end gap-3">
            <span v-if="submitBlocker" class="text-sm text-ink-mute">{{ submitBlocker }}</span>
            <button class="btn btn-primary" :disabled="submitting || Boolean(submitBlocker)" @click="submit">
              {{ submitting ? t('common.loading') : t('task.submit') }}
            </button>
          </div>
          <p v-if="submitError" class="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ submitError }}</p>
        </template>

        <div v-else-if="view === 'evaluating'" class="card flex flex-col items-center gap-3 p-10 text-center">
          <span class="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="sparkles" :size="26" class="pulse-soft" /></span>
          <h2 class="text-lg font-bold">{{ t('task.evaluating') }}</h2>
          <p class="max-w-md text-sm text-ink-soft">{{ slow ? t('task.evaluatingSlow') : t('task.evaluatingText') }}</p>
        </div>

        <div v-else-if="view === 'failed'" class="card p-6">
          <h2 class="text-lg font-bold">{{ t('task.failedTitle') }}</h2>
          <p class="mt-2 text-sm text-ink-soft">{{ t('task.failedText') }}</p>
        </div>

        <AttemptResult v-else-if="view === 'result' && attempt" :attempt="attempt" :instance="instance"
          @rework="rework" @finish="finish" @next="next" @disputed="fetchAttempt(attempt.id, false)" />
      </div>

      <!-- Related norms, shown right away (PRD 4.0) -->
      <aside v-if="!wide" class="flex flex-col gap-3 lg:col-start-2 xl:col-start-auto">
        <NormsPanel :norms="norms" />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import AttemptResult from '@/components/task/AttemptResult.vue'
import NormsPanel from '@/components/task/NormsPanel.vue'
import ReviewEditor, { type ReviewItem } from '@/components/task/ReviewEditor.vue'
import FixCheckEditor, { type Decision } from '@/components/task/FixCheckEditor.vue'
import ProcessCard, { type ProcessAnswer } from '@/components/task/ProcessCard.vue'
import CalendarTool from '@/components/task/CalendarTool.vue'
import MinesBoard, { type MineItem } from '@/components/task/MinesBoard.vue'
import RouteTrainer, { type RouteAnswer } from '@/components/task/RouteTrainer.vue'
import SimPlayer from '@/components/task/SimPlayer.vue'
import HearingPlayer from '@/components/task/HearingPlayer.vue'
import CaseFolder, { type FolderDoc } from '@/components/task/CaseFolder.vue'
import DocumentEditor from '@/components/task/DocumentEditor.vue'
import TimelineEditor, { type TimelineAnswer } from '@/components/task/TimelineEditor.vue'
import ExtractionTable, { type ExtractionCell } from '@/components/task/ExtractionTable.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'
import { useStatsStore } from '@/stores/stats'
import { startTask } from '@/utils/tasks'

const props = defineProps<{ id: string }>()
const { t, te, locale } = useI18n()
const router = useRouter()
const stats = useStatsStore()

const loading = ref(true)
const instance = ref<any>(null)
const norms = ref<any[]>([])
const courts = ref<string[]>([])
const attempt = ref<any>(null)
const view = ref<'edit' | 'evaluating' | 'result' | 'failed'>('edit')
const iteration = ref(1)
const submitting = ref(false)
const submitError = ref('')
const slow = ref(false)
const openedAt = Date.now()
let pollTimer: ReturnType<typeof setTimeout> | null = null

const emptyCard = (): ProcessAnswer => ({ action: '', court: '', courtBasis: '', deadline: '', deadlineCalc: '', fee: null, feeCalc: '', consequences: '' })
const emptyRoute = (): RouteAnswer => ({ qualification: '', steps: [{ bodyCode: '', bodyName: '', basis: '', deadline: '' }], document: '' })
const emptyTimeline = (): TimelineAnswer => ({ deadlines: [], violations: [], summary: '' })
const emptyExtraction = () => ({ cells: [] as ExtractionCell[], notes: '' })
const answers = reactive({ text: '', html: '', items: [] as ReviewItem[], decisions: [] as Decision[], card: emptyCard(), mines: [] as MineItem[], route: emptyRoute(), timeline: emptyTimeline(), extraction: emptyExtraction() })
const folder = ref<FolderDoc[]>([])
const simFinished = ref(false)

const kind = computed(() => {
  const tt = instance.value?.taskType ?? ''
  if (tt.startsWith('draft') || tt === 'proc_draft') return 'draft'
  if (tt === 'review_contract' || tt === 'review_admin_act') return 'review'
  if (tt === 'proc_timeline') return 'timeline'
  if (tt === 'review_fix_check') return 'fix'
  if (tt === 'review_court_act') return 'act'
  if (tt === 'mines') return 'mines'
  if (tt === 'route_and_apply') return 'route'
  if (tt === 'sim_branching') return 'sim'
  if (tt === 'sim_hearing') return 'hearing'
  if (tt === 'extraction_compare') return 'extraction'
  return 'process'
})
// Document trainers need the whole width; norms move under the context column
const wide = computed(() => ['review', 'fix', 'act', 'mines', 'extraction'].includes(kind.value))
const reviewPrefix = computed(() => (kind.value === 'act' ? 'act' : instance.value?.taskType === 'review_admin_act' ? 'adminAct' : 'review'))

const lockedParts = computed(() => {
  const doc = instance.value?.content.lockedDocument as string | undefined
  if (!doc || !doc.includes('{{PART}}')) return null
  const [before, after] = doc.split('{{PART}}')
  return [before.trim(), (after ?? '').trim()]
})
const ruDate = (s: string) => s?.split('-').reverse().join('.')

// What still blocks submission, in words
const submitBlocker = computed(() => {
  if (kind.value === 'draft') return answers.text.trim().length < (instance.value?.taskType === 'draft_part' ? 10 : 30) ? t('task.blockText') : ''
  if (kind.value === 'review') {
    if (!answers.items.length) return t('review.blockEmpty')
    return answers.items.some(i => i.comment.trim().length < 5) ? t('review.blockComment') : ''
  }
  if (kind.value === 'fix') {
    const edits = instance.value?.content.counterpartyEdits ?? []
    return edits.some((e: any) => !answers.decisions.find(d => d.editId === e.id)?.decision) ? t('fix.blockDecisions') : ''
  }
  // A court act may have no errors: an empty list is a valid answer
  if (kind.value === 'act') return answers.items.some(i => i.comment.trim().length < 5) ? t('act.blockComment') : ''
  if (kind.value === 'mines') {
    const incomplete = answers.mines.some(i => i.optionIndex == null && (i.replacement.trim().length < 3 || i.danger.trim().length < 5))
    return incomplete ? t('mines.blockIncomplete') : ''
  }
  if (kind.value === 'route') {
    const r = answers.route
    if (r.qualification.trim().length < 30) return t('route.blockQualification')
    if (!r.steps.length || r.steps.some(s => !s.bodyCode)) return t('route.blockSteps')
    return r.document.trim().length < 30 ? t('route.blockDocument') : ''
  }
  if (kind.value === 'sim' || kind.value === 'hearing') return simFinished.value ? '' : t('sim.blockFinish')
  if (kind.value === 'timeline') {
    const tl = answers.timeline
    if (!tl.deadlines.length && !tl.violations.length) return t('timeline.blockEmpty')
    return tl.deadlines.some(r => !r.fromEventKey) ? t('timeline.blockFrom') : ''
  }
  if (kind.value === 'extraction') return answers.extraction.cells.some(c => c.absent || c.value.trim()) ? '' : t('extraction.blockEmpty')
  return answers.card.action.trim().length < 5 ? t('process.blockAction') : ''
})

function payload() {
  if (kind.value === 'draft') return { text: answers.text, html: answers.html || undefined }
  if (kind.value === 'review' || kind.value === 'act') return { items: answers.items }
  if (kind.value === 'fix') return { decisions: answers.decisions }
  if (kind.value === 'mines') return { items: answers.mines }
  if (kind.value === 'route') return answers.route
  if (kind.value === 'sim' || kind.value === 'hearing') return {}
  if (kind.value === 'timeline') return answers.timeline
  if (kind.value === 'extraction') return answers.extraction
  return answers.card
}

// "Mines" with a timer: the answer goes as it is when the time runs out
function onTimeout() {
  toast(t('mines.timeOver'), 'bad')
  if (!submitting.value && view.value === 'edit' && !submitBlocker.value) submit()
}

// Draft is kept in this browser until it is submitted (light per-viewer convenience)
const draftKey = computed(() => `lh-draft-${props.id}-${iteration.value}`)
function loadDraft(): boolean {
  try {
    const raw = localStorage.getItem(draftKey.value)
    if (!raw) return false
    const saved = JSON.parse(raw)
    Object.assign(answers, saved)
    return true
  } catch { return false }
}
watch(answers, v => { try { if (view.value === 'edit') localStorage.setItem(draftKey.value, JSON.stringify(v)) } catch { /* storage unavailable */ } }, { deep: true })

async function load() {
  loading.value = true
  try {
    const { data } = await apiClient.get(`/tasks/instances/${props.id}`)
    instance.value = data.instance
    norms.value = data.instance.relatedNorms
    if (data.instance.runId) loadFolder(data.instance.runId)
    if (kind.value === 'process') {
      apiClient.get('/courts', { params: { locale: locale.value } }).then(r => { courts.value = r.data.courts.map((c: any) => c.name) }).catch(() => {})
    }
    const last = data.attempts[data.attempts.length - 1]
    if (last) {
      iteration.value = last.iteration
      await fetchAttempt(last.id, false)
    } else {
      loadDraft()
    }
  } catch {
    instance.value = null
  } finally {
    loading.value = false
  }
}

async function fetchAttempt(id: string, announce: boolean) {
  const { data } = await apiClient.get(`/attempts/${id}`)
  attempt.value = data.attempt
  const status = data.attempt.status
  if (status === 'evaluating') {
    view.value = 'evaluating'
    slow.value = data.attempt.retries > 0
    pollTimer = setTimeout(() => fetchAttempt(id, true), 2000)
    return
  }
  view.value = status === 'failed' ? 'failed' : 'result'
  if (announce && view.value === 'result') {
    if (data.attempt.xpAwarded) toast(t('result.xpToast', { n: data.attempt.xpAwarded }), 'ok')
    for (const code of data.attempt.achievements ?? []) toast(t('achievements.earned', { name: t(`achievements.${code}`) }), 'achievement', 4500)
    stats.refresh().catch(() => {})
  }
}

async function submit() {
  submitting.value = true
  submitError.value = ''
  try {
    const { data } = await apiClient.post('/attempts', {
      instanceId: props.id,
      answer: payload(),
      durationSec: Math.round((Date.now() - openedAt) / 1000)
    })
    try { localStorage.removeItem(draftKey.value) } catch { /* storage unavailable */ }
    iteration.value = data.attempt.iteration
    view.value = 'evaluating'
    refreshInstance()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    await fetchAttempt(data.attempt.id, true)
  } catch (e) {
    const code = apiErrorCode(e)
    submitError.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    submitting.value = false
  }
}

// Clicks on "mines", questions to the client and the simulation path live on the server
async function refreshInstance() {
  try {
    const { data } = await apiClient.get(`/tasks/instances/${props.id}`)
    instance.value = data.instance
  } catch { /* the old copy stays */ }
}

// Second iteration starts from the student's own text, like edits from a senior lawyer
async function rework() {
  await refreshInstance()
  const previous = attempt.value?.answer ?? {}
  iteration.value = 2
  if (!loadDraft()) {
    if (kind.value === 'draft') { answers.text = previous.text ?? ''; answers.html = previous.html ?? '' }
    if (kind.value === 'review' || kind.value === 'act') answers.items = (previous.items ?? []).map((i: ReviewItem) => ({ ...i }))
    if (kind.value === 'mines') answers.mines = (previous.items ?? []).map((i: MineItem) => ({ ...i }))
    if (kind.value === 'timeline') answers.timeline = { ...emptyTimeline(), ...previous }
    if (kind.value === 'route') answers.route = { ...emptyRoute(), ...previous, steps: (previous.steps ?? []).map((s: any) => ({ bodyName: '', basis: '', deadline: '', ...s })) }
    if (kind.value === 'fix') answers.decisions = (previous.decisions ?? []).map((d: Decision) => ({ ...d }))
    if (kind.value === 'process') answers.card = { ...emptyCard(), ...previous }
    if (kind.value === 'extraction') answers.extraction = { ...emptyExtraction(), ...previous, cells: (previous.cells ?? []).map((c: ExtractionCell) => ({ ...c })) }
  }
  view.value = 'edit'
}

async function finish() {
  await apiClient.post(`/attempts/instances/${props.id}/close`)
  await fetchAttempt(attempt.value.id, false)
}

// The case folder of a track stage: the documents of the case so far
async function loadFolder(runId: string) {
  try { folder.value = (await apiClient.get(`/runs/${runId}`)).data.run.folder } catch { folder.value = [] }
}

async function next() {
  if (instance.value?.runId) { router.push({ name: 'CaseRun', params: { id: instance.value.runId } }); return }
  if (instance.value?.assignmentId) { router.push({ name: 'Dashboard' }); return }
  const code = await startTask(router, { mode: instance.value?.mode })
  if (code) toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
}

onMounted(load)
onBeforeUnmount(() => { if (pollTimer) clearTimeout(pollTimer) })
</script>
