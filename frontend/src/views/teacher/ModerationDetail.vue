<template>
  <div v-if="data" class="flex flex-col gap-5">
    <div>
      <RouterLink :to="base" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('teacher.nav.moderation') }}</RouterLink>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ data.instance.content.title }}</h1>
      <div class="mt-2 flex flex-wrap gap-2">
        <span class="chip chip-outline">{{ data.student?.fullName }}</span>
        <span class="chip chip-outline">{{ t(`taskTypes.${data.instance.taskType}`) }}</span>
        <span class="chip chip-outline">{{ t('task.iteration', { n: data.attempt.iteration }) }}</span>
        <span v-if="data.instance.isExam" class="chip chip-warn">{{ t('task.exam') }}</span>
        <span v-for="r in data.attempt.reviewReasons" :key="r" class="chip chip-muted">{{ t(`admin.results.reasons.${r}`) }}</span>
      </div>
    </div>

    <div v-if="data.attempt.dispute" class="rounded-xl bg-warn-soft p-4 text-sm text-warn-dark"><b>{{ t('teacher.mod.dispute') }}:</b> {{ data.attempt.dispute.comment }}</div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex min-w-0 flex-col gap-4">
        <details class="card p-5">
          <summary class="cursor-pointer font-bold">{{ t('teacher.mod.task') }}</summary>
          <p class="doc-text mt-3 text-sm">{{ data.instance.content.instructions }}</p>
          <p class="doc-text mt-3 text-sm text-ink-soft">{{ data.instance.content.caseText }}</p>
        </details>

        <h2 class="text-lg font-bold">{{ t('teacher.mod.answer') }}</h2>
        <div v-if="kind === 'draft'" class="card doc-text p-5 text-sm">{{ data.attempt.answer.text }}</div>
        <ReviewEditor v-else-if="kind === 'review' || kind === 'act'" :model-value="data.attempt.answer.items" :text="data.instance.content.documentText" readonly :statuses="itemStatuses"
          :prefix="kind === 'act' ? 'act' : data.instance.taskType === 'review_admin_act' ? 'adminAct' : 'review'" />
        <TimelineEditor v-else-if="kind === 'timeline'" :model-value="{ deadlines: data.attempt.answer.deadlines ?? [], violations: data.attempt.answer.violations ?? [], summary: data.attempt.answer.summary ?? '' }"
          :events="data.instance.content.timelineEvents" readonly />
        <MinesBoard v-else-if="kind === 'mines'" :instance-id="data.instance.id" :model-value="data.attempt.answer.items" :text="data.instance.content.documentText"
          :segments="data.instance.content.mines.segments" :clicks="data.instance.content.mines.clicks" readonly />
        <div v-else-if="kind === 'route'" class="card flex flex-col gap-3 p-5 text-sm">
          <div><b>{{ t('route.step1') }}</b><p class="doc-text mt-1">{{ data.attempt.answer.qualification }}</p></div>
          <div><b>{{ t('route.step2') }}</b>
            <ol class="mt-1 list-decimal pl-5"><li v-for="(st, i) in data.attempt.answer.steps" :key="i">{{ det?.names?.[st.bodyCode] || st.bodyName || st.bodyCode }}<span v-if="st.basis || st.deadline" class="text-ink-soft"> - {{ [st.basis, st.deadline].filter(Boolean).join(' · ') }}</span></li></ol></div>
          <div v-if="data.instance.content.clientDialog?.length"><b>{{ t('route.askTitle') }}</b>
            <ul class="mt-1 flex flex-col gap-1"><li v-for="(d, i) in data.instance.content.clientDialog" :key="i"><i>{{ d.question }}</i> - {{ d.answer }}</li></ul></div>
          <div><b>{{ t('route.step3') }}</b><p class="doc-text mt-1 rounded-xl border border-line p-3">{{ data.attempt.answer.document }}</p></div>
        </div>
        <ol v-else-if="kind === 'sim'" class="flex flex-col gap-2">
          <li v-for="st in det?.steps ?? []" :key="st.index" class="card p-4 text-sm">
            <span class="chip mr-2" :class="{ correct: 'chip-ok', acceptable: 'chip-warn', wrong: 'bg-bad-soft text-bad-dark' }[st.verdict as string]">{{ t(`result.simVerdict.${st.verdict}`) }}</span>
            <b>{{ st.choiceText }}</b>
            <p v-if="st.justification" class="mt-1 text-ink-soft">{{ st.justification }}</p>
            <p v-if="st.freeTextRubric" class="mt-1 text-xs text-ink-mute">{{ t('admin.scen.rubric') }}: {{ st.freeTextRubric }}</p>
          </li>
        </ol>
        <pre v-else-if="kind === 'hearing'" class="card max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-[inherit] text-sm leading-relaxed">{{ det?.protocol }}</pre>
        <FixCheckEditor v-else-if="kind === 'fix'" :model-value="data.attempt.answer.decisions" :text="data.instance.content.documentText" :edits="data.instance.content.counterpartyEdits" readonly :results="fixResults" />
        <ExtractionTable v-else-if="kind === 'extraction'" :model-value="data.attempt.answer.cells ?? []" :documents="data.instance.content.extraction.documents"
          :fields="data.instance.content.extraction.fields" readonly :results="extractionResults" />
        <ProcessCard v-else :model-value="data.attempt.answer" readonly />

        <!-- Engine result in full: the teacher sees the right answers -->
        <div v-if="engineLines.length" class="card p-5">
          <h3 class="font-bold">{{ t('teacher.mod.engine') }}</h3>
          <ul class="mt-2 flex flex-col gap-1.5 text-sm">
            <li v-for="(l, i) in engineLines" :key="i" class="flex gap-2"><Icon :name="l.ok ? 'check' : 'x'" :size="16" :class="l.ok ? 'text-ok' : 'text-bad'" /> {{ l.text }}</li>
          </ul>
        </div>
        <div v-if="data.reference.answer" class="card border-ok/30 bg-ok-soft p-5">
          <h3 class="font-bold text-ok-dark">{{ t('result.referenceTitle') }}</h3>
          <div class="doc-text mt-2 rounded-xl bg-white p-4 text-sm">{{ data.reference.answer }}</div>
        </div>
        <div v-if="refMarkup.length" class="card p-5">
          <h3 class="font-bold">{{ t('result.markupTitle') }}</h3>
          <ul class="mt-2 flex flex-col gap-2 text-sm">
            <li v-for="f in refMarkup" :key="f.id" class="rounded-xl border border-line p-3">
              <span v-if="f.badFor && f.badFor !== 'both'" class="chip chip-outline">{{ f.badFor }}</span> <i>«{{ f.quote }}»</i>
              <p class="mt-1 text-ink-soft">{{ f.explanation }}</p>
            </li>
          </ul>
        </div>
        <div class="card p-5">
          <h3 class="font-bold">{{ t('teacher.mod.aiFeedback') }}</h3>
          <p class="mt-2 text-sm">{{ data.attempt.ai?.feedback }}</p>
          <ul v-if="data.attempt.ai?.errors?.length" class="mt-3 flex flex-col gap-2 text-sm">
            <li v-for="(e, i) in data.attempt.ai.errors" :key="i"><b>{{ te(`errorTypes.${e.errorType}`) ? t(`errorTypes.${e.errorType}`) : e.errorType }}</b>: {{ e.comment }} <span v-if="e.normRef" class="text-ink-mute">({{ e.normRef }})</span></li>
          </ul>
        </div>
      </div>

      <!-- Scores: the AI score stays in the history as the reference pair (PRD 5.3) -->
      <form class="card h-fit p-5 lg:sticky lg:top-20" @submit.prevent="save">
        <h2 class="font-bold">{{ t('teacher.mod.scores') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('teacher.mod.scoresHint') }}</p>
        <div v-for="c in scores" :key="c.key" class="mt-4">
          <div class="flex items-center justify-between gap-2 text-sm">
            <label :for="`m-${c.key}`" class="font-semibold">{{ t(`result.criteria.${c.key}`) }} <span class="font-normal text-ink-mute">· {{ t('result.weight', { n: c.weight }) }}</span></label>
            <input :id="`m-${c.key}`" v-model.number="c.score" type="number" min="0" max="100" class="input !w-20 !py-1.5 text-right" />
          </div>
          <p v-if="aiComment(c.key)" class="mt-1 text-xs text-ink-mute">{{ t('teacher.mod.ai') }} {{ aiScore(c.key) }}: {{ aiComment(c.key) }}</p>
        </div>
        <div class="mt-4 flex items-center justify-between rounded-xl bg-paper p-3 text-sm">
          <span>{{ t('teacher.mod.total') }}</span>
          <span><span class="text-ink-mute line-through" v-if="total !== data.attempt.finalScore">{{ data.attempt.finalScore }}</span> <b class="text-lg">{{ total }}</b></span>
        </div>
        <label class="label mt-4" for="m-comment">{{ t('teacher.mod.comment') }}</label>
        <textarea id="m-comment" v-model="comment" class="input" rows="3" :placeholder="t('teacher.mod.commentHint')" />
        <button class="btn btn-primary mt-4 w-full" :disabled="busy">{{ total === data.attempt.finalScore ? t('teacher.mod.confirm') : t('teacher.mod.save') }}</button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import ReviewEditor from '@/components/task/ReviewEditor.vue'
import FixCheckEditor from '@/components/task/FixCheckEditor.vue'
import ProcessCard from '@/components/task/ProcessCard.vue'
import MinesBoard from '@/components/task/MinesBoard.vue'
import TimelineEditor from '@/components/task/TimelineEditor.vue'
import ExtractionTable from '@/components/task/ExtractionTable.vue'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const props = defineProps<{ id: string }>()
const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()
const base = computed(() => (route.path.startsWith('/admin') ? '/admin/moderation' : '/teacher/moderation'))
const data = ref<any>(null)
const scores = ref<{ key: string; score: number; weight: number }[]>([])
const comment = ref('')
const busy = ref(false)

onMounted(async () => {
  data.value = (await apiClient.get(`/teacher/moderation/${props.id}`)).data
  scores.value = (data.value.attempt.criteria ?? []).map((c: any) => ({ key: c.key, score: c.score, weight: c.weight }))
  comment.value = data.value.attempt.moderation?.comment ?? ''
})

const kind = computed(() => {
  const tt = data.value?.instance.taskType ?? ''
  if (tt.startsWith('draft') || tt === 'proc_draft') return 'draft'
  const map: Record<string, string> = { review_contract: 'review', review_admin_act: 'review', review_fix_check: 'fix', review_court_act: 'act', mines: 'mines', route_and_apply: 'route', sim_branching: 'sim', sim_hearing: 'hearing', proc_timeline: 'timeline', extraction_compare: 'extraction' }
  return map[tt] ?? 'process'
})
const det = computed(() => data.value?.attempt.deterministic)
// Contract and court act flaws, or "mines"
const refMarkup = computed<any[]>(() => {
  const e = data.value?.reference.engine
  return e?.kind === 'review' || e?.kind === 'court_act' ? e.flaws ?? [] : e?.kind === 'mines' ? e.mines ?? [] : []
})
const total = computed(() => {
  const w = scores.value.reduce((a, c) => a + c.weight, 0)
  return w ? Math.round(scores.value.reduce((a, c) => a + c.weight * (Number(c.score) || 0), 0) / w) : 0
})
const aiScore = (key: string) => data.value?.attempt.ai?.criteria?.find((c: any) => c.key === key)?.score
const aiComment = (key: string) => data.value?.attempt.ai?.criteria?.find((c: any) => c.key === key)?.comment
const itemStatuses = computed<Record<number, string>>(() => {
  const d = det.value
  if (!d || (d.kind !== 'review' && d.kind !== 'court_act')) return {}
  const s: Record<number, string> = {}
  for (const f of d.found) s[f.itemIndex] = 'found'
  for (const i of d.extras) s[i] = d.justifiedExtras?.includes(i) ? 'justified' : 'extra'
  for (const x of d.againstClient ?? []) s[x.itemIndex] = 'against'
  return s
})
// The teacher sees the reference value of every cell next to the student's one
const extractionResults = computed(() => {
  const d = det.value
  if (d?.kind !== 'extraction') return {}
  const ref = data.value.reference.engine?.cells ?? []
  const comments = new Map<number, string>((data.value.attempt.ai?.items ?? []).map((i: any) => [i.index, i.comment]))
  return Object.fromEntries(d.cells.map((c: any) => [`${c.documentId}|${c.fieldKey}`, {
    ...c, comment: comments.get(c.index) ?? '',
    expected: ref[c.index] ? { value: ref[c.index].value, absent: ref[c.index].absent, quote: ref[c.index].quote } : null
  }]))
})
const fixResults = computed(() => {
  const d = det.value
  if (!d || d.kind !== 'fix_check') return null
  const edits = data.value.reference.engine?.edits ?? []
  return d.results.map((r: any) => ({ ...r, explanation: edits.find((e: any) => e.id === r.editId)?.explanation ?? '' }))
})
const fmt = (v: any) => (typeof v === 'number' ? v.toLocaleString('ru-RU') : Array.isArray(v) ? v.join('; ') : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('.') : v ?? '-')
const engineLines = computed(() => {
  const d = det.value
  const names = (codes: string[]) => codes.map(c => d?.names?.[c] ?? c).join(', ')
  if (d?.kind === 'route') {
    return [
      { ok: d.score === 100, text: t('result.routeScore', { n: d.score }) + (d.optimal ? ` · ${t('result.routeOptimal')}` : '') },
      ...(d.missingPretrial?.length ? [{ ok: false, text: `${t('result.missingPretrial', { n: d.missingPretrial.length })}: ${names(d.missingPretrial)}` }] : []),
      ...(d.wrongBodies?.length ? [{ ok: false, text: t('result.wrongBody', { body: names(d.wrongBodies) }) }] : []),
      { ok: d.revealedFacts?.length === d.onRequestTotal, text: t('result.factsRevealed', { n: d.revealedFacts?.length ?? 0, total: d.onRequestTotal ?? 0 }) }
    ]
  }
  if (d?.kind === 'mines') {
    return [
      { ok: !d.missed.length, text: `${t('result.found')}: ${d.handled.length} / ${d.total}` },
      { ok: !d.falseClicks, text: `${t('result.falseClicks')}: ${d.falseClicks}` }
    ]
  }
  if (d?.kind === 'sim') return [{ ok: d.outcome === 'win', text: `${t(`sim.outcome.${d.outcome || 'partial'}`)} · ${d.score}` }]
  if (d?.kind === 'hearing') return [{ ok: d.outcome === 'win', text: `${t(`sim.outcome.${d.outcome || 'partial'}`)}${d.outcomeReason ? ` · ${d.outcomeReason}` : ''}` }]
  if (d?.kind === 'extraction') {
    return [
      { ok: d.correct === d.total, text: `${t('extraction.status.correct')}: ${d.correct} / ${d.total} · ${t('extraction.status.partial')}: ${d.partial} · ${t('extraction.status.empty')}: ${d.empty}` },
      { ok: d.reasoningCap === 100, text: `${t('extraction.sourcesShare')}: ${d.reasoningCap}%` }
    ]
  }
  if (d?.kind === 'court_act') {
    return [
      { ok: !d.missed.length, text: `${t('result.found')}: ${d.found.length} / ${d.targets}` },
      ...(d.valueChecks ?? []).map((v: any) => ({ ok: v.ok, text: `${t('result.exactValue')} #${v.itemIndex + 1}` }))
    ]
  }
  if (d?.kind === 'timeline') {
    return [
      ...d.checks.map((c: any) => ({ ok: c.ok, text: `${c.label}: ${fmt(c.actual)} / ${t('result.expected').toLowerCase()} ${fmt(c.expected)}` })),
      { ok: !d.violations.missed.length && !d.violations.extra.length, text: `${t('result.violationsTitle')}: ${d.violations.found.length} / ${d.violations.expected.length}` }
    ]
  }
  if (!d?.checks) return []
  return d.checks.map((c: any) => ({ ok: c.ok, text: `${t(`result.checks.${c.key}`)}: ${fmt(c.actual)} / ${t('result.expected').toLowerCase()} ${fmt(c.expected)}` }))
})

async function save() {
  busy.value = true
  try {
    await apiClient.post(`/teacher/moderation/${props.id}`, { criteria: scores.value.map(c => ({ key: c.key, score: c.score })), comment: comment.value })
    toast(t('teacher.mod.saved'), 'ok')
    router.push(base.value)
  } catch {
    toast(t('errors.generic'), 'bad')
  } finally {
    busy.value = false
  }
}
</script>
