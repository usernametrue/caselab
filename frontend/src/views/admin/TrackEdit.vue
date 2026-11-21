<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <RouterLink to="/admin/tracks" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('admin.tracks.title') }}</RouterLink>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ isNew ? t('admin.tracks.create') : (f.title[lang] || f.title.ru || f.title.uz) }}</h1>
        <p v-if="source === 'ai'" class="mt-1 flex items-center gap-1 text-sm font-semibold text-brand"><Icon name="sparkles" :size="15" /> {{ t('admin.tracks.aiNote') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-if="!isNew && f.status !== 'published'" class="btn btn-ghost" :disabled="saving" @click="publishAll"><Icon name="check" :size="17" /> {{ t('admin.tracks.publishAll') }}</button>
        <button v-if="!isNew" class="btn btn-ghost" @click="exportJson"><Icon name="file" :size="16" /> JSON</button>
        <button v-if="!isNew" class="btn btn-ghost text-bad" @click="remove">{{ t('common.delete') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('common.loading') : t('common.save') }}</button>
      </div>
    </div>

    <div v-if="problems.length" class="rounded-xl bg-warn-soft p-4 text-sm text-warn-dark">
      <b>{{ t('admin.scen.problems') }}</b>
      <ul class="mt-1 list-disc pl-5"><li v-for="(p, i) in problems" :key="i">{{ p }}</li></ul>
    </div>
    <p v-if="error" class="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ error }}</p>

    <!-- The case world -->
    <section class="card flex flex-col gap-4 p-5">
      <h2 class="font-bold">{{ t('admin.tracks.world') }}</h2>
      <LocalizedField v-model="f.title" :label="t('admin.templates.fTitle')" />
      <LocalizedField v-model="f.description" :label="t('admin.tracks.description')" multiline :rows="2" />
      <LocalizedField v-model="f.role" :label="t('admin.templates.fRole')" />
      <div class="grid gap-4 sm:grid-cols-3">
        <div><label class="label" for="tr-start">{{ t('admin.tracks.startDate') }}</label><input id="tr-start" v-model="f.startDate" type="date" class="input" />
          <p class="mt-1 text-xs text-ink-mute">{{ t('admin.tracks.startDateHint') }}</p></div>
        <div><label class="label" for="tr-first">{{ t('admin.tracks.firstStage') }}</label>
          <select id="tr-first" v-model="f.firstStageKey" class="input"><option v-for="s in f.stages" :key="s.key" :value="s.key">{{ s.key }}</option></select></div>
        <div><label class="label" for="tr-status">{{ t('admin.templates.status') }}</label>
          <select id="tr-status" v-model="f.status" class="input"><option v-for="st in ['draft', 'review', 'published']" :key="st" :value="st">{{ t(`admin.templates.statuses.${st}`) }}</option></select></div>
      </div>

      <div>
        <div class="label">{{ t('admin.tracks.values') }}</div>
        <p class="-mt-1 mb-2 text-xs text-ink-mute">{{ t('admin.tracks.valuesHint') }}</p>
        <div v-for="(v, i) in f.values" :key="i" class="mb-2 grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[150px_130px_1fr_auto]">
          <input v-model.trim="v.key" class="input" placeholder="debt" :aria-label="t('admin.templates.varKey')" />
          <select v-model="v.kind" class="input" :aria-label="t('admin.templates.varKind')">
            <option value="money">{{ t('admin.templates.kinds.money') }}</option><option value="date">{{ t('admin.templates.kinds.date') }}</option><option value="text">{{ t('admin.tracks.text') }}</option>
          </select>
          <input v-if="v.kind === 'money'" v-model.trim="v.value" class="input" inputmode="numeric" placeholder="84000000" :aria-label="t('admin.tracks.value')" />
          <input v-else-if="v.kind === 'date'" v-model="v.value" type="date" class="input" :aria-label="t('admin.tracks.value')" />
          <LocalizedField v-else v-model="v.text" :label="t('admin.tracks.value')" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.values.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button type="button" class="btn btn-ghost" @click="f.values.push({ key: '', kind: 'money', value: '', text: L() })"><Icon name="plus" :size="16" /> {{ t('admin.tracks.addValue') }}</button>
      </div>

      <div>
        <div class="label">{{ t('caseRun.folder') }}</div>
        <p class="-mt-1 mb-2 text-xs text-ink-mute">{{ t('admin.tracks.folderHint') }}</p>
        <div v-for="(d, i) in f.folder" :key="i" class="mb-2 rounded-xl border border-line p-3">
          <div class="grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <LocalizedField v-model="d.title" :label="t('admin.templates.fTitle')" />
            <div><label class="label" :for="`fd-${i}`">{{ t('admin.tracks.docDate') }}</label><input :id="`fd-${i}`" v-model="d.date" type="date" class="input" /></div>
            <button type="button" class="btn-icon btn self-end text-bad" :aria-label="t('common.delete')" @click="f.folder.splice(i, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <LocalizedField v-model="d.text" class="mt-2" :label="t('admin.docs.text')" multiline :rows="4" />
        </div>
        <button type="button" class="btn btn-ghost" @click="f.folder.push({ title: L(), text: L(), date: '' })"><Icon name="plus" :size="16" /> {{ t('admin.tracks.addDoc') }}</button>
      </div>
    </section>

    <!-- Stages and transitions -->
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.tracks.stages') }}</h2>
        <button class="btn btn-ghost" @click="addStage"><Icon name="plus" :size="16" /> {{ t('admin.tracks.addStage') }}</button>
      </div>
      <p class="text-sm text-ink-soft">{{ t('admin.tracks.stagesHint') }}</p>
      <div v-for="(s, i) in f.stages" :key="i" class="card p-5" :class="s.key === f.firstStageKey ? 'border-brand/50' : ''">
        <div class="grid gap-3 md:grid-cols-[150px_1fr_auto]">
          <div><label class="label !text-xs" :for="`sk-${i}`">{{ t('admin.tracks.stageKey') }}</label><input :id="`sk-${i}`" v-model.trim="s.key" class="input" /></div>
          <LocalizedField v-model="s.title" :label="t('admin.templates.fTitle')" />
          <button class="btn btn-icon self-end text-bad" :aria-label="t('common.delete')" @click="f.stages.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-[1fr_120px_120px]">
          <div><label class="label !text-xs" :for="`st-${i}`">{{ t('admin.tracks.template') }}</label>
            <EntityPicker v-model="s.templateId" kind="template" :input-id="`st-${i}`" :options="templateOptions" @changed="reloadTemplates" /></div>
          <div><label class="label !text-xs" :for="`sd-${i}`">{{ t('admin.tracks.daysAfter') }}</label><input :id="`sd-${i}`" v-model.number="s.daysAfter" type="number" min="0" class="input" /></div>
          <div><label class="label !text-xs" :for="`sw-${i}`">{{ t('admin.tracks.weight') }}</label><input :id="`sw-${i}`" v-model.number="s.weight" type="number" min="0" step="0.5" class="input" /></div>
        </div>
        <div class="mt-3 flex flex-wrap gap-4 text-sm">
          <label class="flex items-center gap-2"><input v-model="s.setback" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.tracks.setback') }}</label>
          <label class="flex items-center gap-2"><input v-model="s.opponentBefore.enabled" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.tracks.opponent') }}</label>
        </div>
        <div v-if="s.opponentBefore.enabled" class="mt-3 flex flex-col gap-2 rounded-xl bg-paper p-3">
          <LocalizedField v-model="s.opponentBefore.title" :label="t('admin.tracks.opponentTitle')" />
          <LocalizedField v-model="s.opponentBefore.brief" :label="t('admin.tracks.opponentBrief')" multiline :rows="3" />
        </div>

        <h3 class="mt-4 text-sm font-bold">{{ t('admin.tracks.transitions') }}</h3>
        <div v-for="(tr, ti) in s.transitions" :key="ti" class="mt-2 grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[1fr_140px_1fr_1fr_auto]">
          <select v-model="tr.condition.kind" class="input" :aria-label="t('admin.tracks.condition')"><option v-for="k in conditionKinds" :key="k" :value="k">{{ t(`admin.tracks.conditions.${k}`) }}</option></select>
          <select v-if="tr.condition.kind.startsWith('check_')" v-model="tr.condition.param" class="input" :aria-label="t('admin.tracks.param')"><option v-for="c in ['court', 'fee', 'deadline', 'claim_amount']" :key="c" :value="c">{{ t(`result.checks.${c}`) }}</option></select>
          <select v-else-if="tr.condition.kind === 'sim_outcome'" v-model="tr.condition.param" class="input" :aria-label="t('admin.tracks.param')"><option v-for="o in ['win', 'partial', 'loss']" :key="o" :value="o">{{ t(`sim.outcome.${o}`) }}</option></select>
          <input v-else-if="['score_below', 'score_at_least', 'route_score_below'].includes(tr.condition.kind)" v-model="tr.condition.param" type="number" min="0" max="100" class="input" :aria-label="t('admin.tracks.param')" />
          <span v-else />
          <select v-model="tr.next" class="input" :aria-label="t('admin.tracks.next')"><option value="" disabled>{{ t('admin.tracks.next') }}</option><option v-for="n in nextOptions(s.key)" :key="n.value" :value="n.value">{{ n.label }}</option></select>
          <select v-model="tr.courtAct" class="input" :aria-label="t('admin.tracks.courtAct')"><option value="">{{ t('admin.tracks.noAct') }}</option><option v-for="a in courtActs" :key="a" :value="a">{{ t(`caseRun.acts.${a}`) }}</option></select>
          <button class="btn btn-icon text-bad" :aria-label="t('common.delete')" @click="s.transitions.splice(ti, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button class="btn btn-link mt-2" @click="s.transitions.push({ condition: { kind: 'check_failed', param: 'court' }, next: '', courtAct: '' })"><Icon name="plus" :size="15" /> {{ t('admin.tracks.addTransition') }}</button>
        <div class="mt-3 grid gap-2 md:grid-cols-2">
          <div><label class="label !text-xs" :for="`dn-${i}`">{{ t('admin.tracks.defaultNext') }}</label>
            <select :id="`dn-${i}`" v-model="s.defaultNext" class="input"><option value="" disabled>-</option><option v-for="n in nextOptions(s.key)" :key="n.value" :value="n.value">{{ n.label }}</option></select></div>
          <div><label class="label !text-xs" :for="`da-${i}`">{{ t('admin.tracks.courtAct') }}</label>
            <select :id="`da-${i}`" v-model="s.defaultCourtAct" class="input"><option value="">{{ t('admin.tracks.noAct') }}</option><option v-for="a in courtActs" :key="a" :value="a">{{ t(`caseRun.acts.${a}`) }}</option></select></div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import LocalizedField from '@/components/ui/LocalizedField.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'
import EntityPicker from '@/components/ui/EntityPicker.vue'

const props = defineProps<{ id: string }>()
const { t, te, locale } = useI18n()
const router = useRouter()
const lang = computed(() => locale.value as 'ru' | 'uz')
const isNew = computed(() => props.id === 'new')
const L = () => ({ ru: '', uz: '' })
const conditionKinds = ['always', 'score_below', 'score_at_least', 'check_failed', 'check_ok', 'route_score_below', 'missed_any', 'sim_outcome']
const courtActs = ['accept_claim', 'return_claim', 'leave_without_motion', 'order_issued', 'order_cancelled', 'decision_for_client', 'decision_partial', 'decision_against_client', 'appeal_accepted']

const newStage = (key: string) => ({ key, title: L(), templateId: '', daysAfter: 0, weight: 1, setback: false, opponentBefore: { enabled: false, title: L(), brief: L() }, transitions: [] as any[], defaultNext: '', defaultCourtAct: '' })
const f = reactive<any>({ title: L(), description: L(), role: L(), startDate: '', values: [], folder: [], stages: [newStage('s1')], firstStageKey: 's1', status: 'draft' })
const source = ref('manual')
const templates = ref<any[]>([])
const problems = ref<string[]>([])
const error = ref('')
const saving = ref(false)

const nextOptions = (own: string) => [
  ...f.stages.filter((s: any) => s.key && s.key !== own).map((s: any) => ({ value: s.key, label: `${t('admin.tracks.toStage')} ${s.key}` })),
  ...['win', 'partial', 'loss'].map(o => ({ value: `outcome:${o}`, label: `${t('admin.tracks.toOutcome')}: ${t(`caseRun.outcomes.${o}`)}` }))
]
function addStage() {
  let k = f.stages.length + 1
  while (f.stages.some((s: any) => s.key === `s${k}`)) k++
  f.stages.push(newStage(`s${k}`))
}

// Stage templates: chosen, edited or created in the side panel without leaving the track
const templateOptions = computed(() => templates.value.map((tpl: any) => ({ id: tpl._id, label: `${tpl.title[lang.value] || tpl.title.ru} · ${t(`taskTypes.${tpl.taskType}`)} · ${t(`admin.templates.statuses.${tpl.status}`)}` })))
async function reloadTemplates() { templates.value = (await apiClient.get('/admin/templates')).data.templates }

async function load() {
  await reloadTemplates()
  if (isNew.value) return
  const { data } = await apiClient.get(`/admin/tracks/${props.id}`)
  const tr = data.track
  source.value = tr.source
  Object.assign(f, {
    title: tr.title, description: tr.description ?? L(), role: tr.role ?? L(), startDate: tr.startDate ?? '', status: tr.status, firstStageKey: tr.firstStageKey,
    values: (tr.values ?? []).map((v: any) => ({ key: v.key, kind: v.kind, value: v.value ?? '', text: v.text ?? L() })),
    folder: (tr.folder ?? []).map((d: any) => ({ title: d.title, text: d.text ?? L(), date: d.date ?? '' })),
    stages: (tr.stages ?? []).map((s: any) => ({
      ...newStage(s.key), ...s, templateId: String(s.templateId),
      opponentBefore: { enabled: Boolean(s.opponentBefore?.enabled), title: s.opponentBefore?.title ?? L(), brief: s.opponentBefore?.brief ?? L() },
      transitions: (s.transitions ?? []).map((x: any) => ({ condition: { kind: x.condition.kind, param: x.condition.param ?? '' }, next: x.next, courtAct: x.courtAct ?? '' }))
    }))
  })
  problems.value = data.problems
}
onMounted(load)
watch(() => props.id, load)

async function save() {
  saving.value = true
  error.value = ''
  try {
    const { data } = isNew.value ? await apiClient.post('/admin/tracks', f) : await apiClient.put(`/admin/tracks/${props.id}`, f)
    problems.value = data.problems
    toast(t('common.saved'), 'ok')
    if (isNew.value) router.replace(`/admin/tracks/${data.track._id}`)
  } catch (e: any) {
    const details = e?.response?.data?.error?.details
    if (Array.isArray(details)) problems.value = details.map((d: any) => `${(d.path ?? []).join('.')}: ${d.message}`)
    const code = apiErrorCode(e)
    error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    saving.value = false
  }
}

// After review: the track goes live with its templates, documents and scenarios
async function publishAll() {
  saving.value = true
  try {
    const { data } = await apiClient.post(`/admin/tracks/${props.id}/publish-all`)
    toast(t('admin.tracks.publishedAll', { n: data.published.templates }), 'ok')
    await load()
  } catch (e: any) {
    const details = e?.response?.data?.error?.details
    if (Array.isArray(details)) problems.value = details.map((d: any) => d.message)
    toast(t('errors.generic'), 'bad')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!window.confirm(t('admin.tracks.confirmDelete'))) return
  const { data } = await apiClient.delete(`/admin/tracks/${props.id}`)
  toast(data.archived ? t('admin.tracks.archived') : t('common.deleted'), 'ok')
  router.push('/admin/tracks')
}

// The track with its templates, documents and scenarios in the content pack format (ADM-8)
async function exportJson() {
  const { data } = await apiClient.get('/admin/import/export', { params: { trackIds: props.id } })
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `track-${props.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>
