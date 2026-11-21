<template>
  <form class="flex flex-col gap-5" @submit.prevent="save">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <RouterLink v-if="!embedded" :to="listPath" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ teacherMode ? t('teacher.nav.content') : t('admin.nav.documents') }}</RouterLink>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ isNew ? t('admin.docs.create') : t('admin.docs.edit') }}</h1>
        <p v-if="d.source === 'ai'" class="mt-1 flex items-center gap-1 text-sm font-semibold text-brand"><Icon name="sparkles" :size="15" /> {{ t('admin.docs.aiDraftNote') }}</p>
      </div>
      <div class="flex gap-2">
        <button v-if="!isNew" type="button" class="btn btn-ghost" @click="remove">{{ t('common.delete') }}</button>
        <button class="btn btn-primary" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </div>

    <UsedBy v-if="!isNew && !teacherMode" kind="document" :id="docId" :embedded="embedded" />
    <div v-if="errors.length" class="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad-dark" role="alert">
      <div class="font-bold">{{ t('admin.templates.fixErrors') }}</div>
      <ul class="mt-1 list-disc pl-5"><li v-for="(e, i) in errors" :key="i">{{ e }}</li></ul>
    </div>

    <section class="card grid gap-4 p-5 sm:grid-cols-4">
      <div class="sm:col-span-2"><label class="label" for="d-title">{{ t('admin.templates.fTitle') }}</label><input id="d-title" v-model="d.title" class="input" /></div>
      <div><label class="label" for="d-type">{{ t('admin.docs.type') }}</label>
        <select id="d-type" v-model="d.type" class="input"><option v-for="ty in types" :key="ty" :value="ty">{{ t(`admin.docs.types.${ty}`) }}</option></select></div>
      <div><label class="label" for="d-status">{{ t('admin.templates.status') }}</label>
        <select id="d-status" v-model="d.status" class="input"><option v-for="s in statuses" :key="s" :value="s">{{ t(`admin.templates.statuses.${s}`) }}</option></select></div>
      <div><label class="label" for="d-lang">{{ t('common.language') }}</label>
        <select id="d-lang" v-model="d.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div><label class="label" for="d-script">{{ t('admin.docs.script') }}</label>
        <select id="d-script" v-model="d.script" class="input"><option value="latn">{{ t('admin.docs.latn') }}</option><option value="cyrl">{{ t('admin.docs.cyrl') }}</option></select></div>
      <div class="sm:col-span-4">
        <div class="label">{{ t('admin.docs.parties') }}</div>
        <p class="-mt-1 mb-2 text-xs text-ink-mute">{{ t('admin.docs.partiesHint') }}</p>
        <div v-for="(p, i) in d.parties" :key="i" class="mb-2 grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
          <input v-model.trim="p.key" class="input" placeholder="customer" :aria-label="t('admin.docs.partyKey')" />
          <input v-model="p.name.ru" class="input" placeholder="RU" :aria-label="`${t('admin.docs.partyName')} ru`" />
          <input v-model="p.name.uz" class="input" placeholder="UZ" :aria-label="`${t('admin.docs.partyName')} uz`" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="d.parties.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button type="button" class="btn btn-ghost" @click="d.parties.push({ key: '', name: { ru: '', uz: '' } })"><Icon name="plus" :size="16" /> {{ t('admin.docs.addParty') }}</button>
      </div>
    </section>

    <section class="grid gap-4 xl:grid-cols-2">
      <div class="card p-5">
        <label class="label" for="d-text">{{ t('admin.docs.text') }}</label>
        <textarea id="d-text" v-model="d.text" class="input min-h-[420px] text-sm" />
      </div>
      <div class="card p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="label !mb-0">{{ t('admin.docs.preview') }}</span>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-ghost !min-h-9 text-sm" :disabled="!selection" @click="addFlaw">{{ t('admin.docs.addFlawSel') }}</button>
            <button v-if="!isAct" type="button" class="btn btn-ghost !min-h-9 text-sm" :disabled="!selection" @click="addEdit">{{ t('admin.docs.addEditSel') }}</button>
            <button v-else type="button" class="btn btn-ghost !min-h-9 text-sm" :disabled="!selection" @click="addSegment">{{ t('admin.docs.addSegmentSel') }}</button>
          </div>
        </div>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.docs.previewHint') }}</p>
        <div ref="previewEl" class="doc-text mt-3 max-h-[420px] overflow-auto rounded-xl border border-line p-4 text-sm leading-7" @mouseup="captureSelection">
          <template v-for="seg in segments" :key="seg.start">
            <span v-if="seg.kind === 'plain'">{{ d.text.slice(seg.start, seg.end) }}</span>
            <mark v-else :class="seg.kind === 'flaw' ? 'bg-warn-soft' : 'bg-sky-soft'" :title="seg.label">{{ d.text.slice(seg.start, seg.end) }}</mark>
          </template>
        </div>
      </div>
    </section>

    <!-- Court act (PRD 4.3): internal markup of the parts, AI copy with errors -->
    <section v-if="isAct" class="card grid gap-4 p-5 sm:grid-cols-3">
      <h2 class="font-bold sm:col-span-3">{{ t('admin.docs.actTitle') }}</h2>
      <div><label class="label" for="d-case">{{ t('admin.docs.caseNumber') }}</label><input id="d-case" v-model="d.caseNumber" class="input" /></div>
      <div><label class="label" for="d-acttype">{{ t('admin.docs.actType') }}</label>
        <select id="d-acttype" v-model="d.actType" class="input"><option value="">-</option><option v-for="a in ['decision', 'resolution', 'ruling', 'order']" :key="a" :value="a">{{ t(`admin.docs.actTypes.${a}`) }}</option></select></div>
      <div><label class="label" for="d-inst">{{ t('admin.templates.feeInstance') }}</label>
        <select id="d-inst" v-model="d.instance" class="input"><option value="">-</option><option v-for="i in ['first', 'appeal', 'cassation', 'revision']" :key="i" :value="i">{{ t(`admin.templates.instances.${i}`) }}</option></select></div>
      <div class="sm:col-span-3">
        <div class="label">{{ t('admin.docs.segments') }}</div>
        <p class="-mt-1 mb-2 text-xs text-ink-mute">{{ t('admin.docs.segmentsHint') }}</p>
        <div v-for="(sg, i) in d.segments" :key="i" class="mb-2 grid gap-2 sm:grid-cols-[220px_1fr_auto]" :class="{ 'text-bad-dark': !found(sg.startQuote) }">
          <select v-model="sg.key" class="input" :aria-label="t('admin.docs.segment')"><option v-for="k in segmentKeys" :key="k" :value="k">{{ t(`act.segments.${k}`) }}</option></select>
          <input v-model="sg.startQuote" class="input" :class="{ 'is-error': !found(sg.startQuote) }" :aria-label="t('admin.docs.startQuote')" :placeholder="t('admin.docs.startQuote')" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="d.segments.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
      </div>
      <div v-if="!isNew && d.segments.length && !teacherMode" class="flex flex-wrap items-end gap-3 rounded-xl bg-brand-tint p-4 sm:col-span-3">
        <p class="w-full text-sm text-ink-soft">{{ t('admin.docs.injectLead') }}</p>
        <div><label class="label !text-xs" for="inj-n">{{ t('admin.docs.flawsCount') }}</label><input id="inj-n" v-model.number="inject.errorsCount" type="number" min="1" max="8" class="input !w-24" /></div>
        <div><label class="label !text-xs" for="inj-d">{{ t('admin.templates.difficulty') }}</label>
          <select id="inj-d" v-model.number="inject.difficulty" class="input !w-24"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select></div>
        <button type="button" class="btn btn-ghost" :disabled="injecting" @click="injectErrors"><Icon name="sparkles" :size="17" /> {{ injecting ? t('admin.docs.generating') : t('admin.docs.injectRun') }}</button>
      </div>
      <p v-if="d.originalId" class="text-sm text-ink-soft sm:col-span-3">{{ t('admin.docs.copyOf') }} <RouterLink :to="`/admin/documents/${d.originalId}`" class="font-semibold text-brand">{{ t('admin.docs.original') }}</RouterLink></p>
    </section>

    <!-- Markup: flaws -->
    <section class="card p-5">
      <h2 class="font-bold">{{ t('admin.docs.flaws') }} <span class="text-ink-mute">· {{ d.flaws.length }}</span></h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.docs.flawsHint') }}</p>
      <div v-for="(f, i) in d.flaws" :key="i" class="mt-3 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-4" :class="{ 'border-bad': !found(f.quote) }">
        <div class="sm:col-span-4">
          <label class="label !text-xs" :for="`fq-${i}`">{{ t('admin.docs.quote') }} <span v-if="!found(f.quote)" class="font-normal text-bad-dark">· {{ t('admin.docs.quoteMissing') }}</span></label>
          <textarea :id="`fq-${i}`" v-model="f.quote" class="input text-sm" rows="2" />
        </div>
        <div><label class="label !text-xs" :for="`fb-${i}`">{{ t('admin.docs.badFor') }}</label>
          <select :id="`fb-${i}`" v-model="f.badFor" class="input"><option value="both">{{ t('admin.docs.both') }}</option><option v-for="p in d.parties" :key="p.key" :value="p.key">{{ p.name.ru || p.key }}</option></select></div>
        <div><label class="label !text-xs" :for="`fs-${i}`">{{ t('admin.docs.severity') }}</label>
          <select :id="`fs-${i}`" v-model="f.severity" class="input"><option v-for="s in ['low', 'medium', 'high']" :key="s" :value="s">{{ t(`admin.docs.severities.${s}`) }}</option></select></div>
        <div><label class="label !text-xs" :for="`ft-${i}`">{{ t('admin.docs.flawType') }}</label><input :id="`ft-${i}`" v-model="f.type" class="input" /></div>
        <div><label class="label !text-xs" :for="`fn-${i}`">{{ t('admin.docs.normRef') }}</label><input :id="`fn-${i}`" v-model="f.normRef" class="input" placeholder="ст. 333 ГК" /></div>
        <LocalizedField v-model="f.explanation" class="sm:col-span-4" :label="t('admin.docs.explanation')" multiline :rows="2" />
        <LocalizedField v-model="f.fix" class="sm:col-span-4" :label="isAct ? t('admin.docs.fixAct') : t('admin.docs.fix')" multiline :rows="2" />
        <template v-if="isAct">
          <div><label class="label !text-xs" :for="`fsg-${i}`">{{ t('admin.docs.segment') }}</label>
            <select :id="`fsg-${i}`" v-model="f.segmentKey" class="input"><option value="">{{ t('admin.docs.segmentAuto') }}</option><option v-for="k in segmentKeys" :key="k" :value="k">{{ t(`act.segments.${k}`) }}</option></select></div>
          <div><label class="label !text-xs" :for="`fek-${i}`">{{ t('admin.docs.expectedKind') }}</label>
            <select :id="`fek-${i}`" v-model="f.expectedValue.kind" class="input"><option v-for="k in ['none', 'date', 'money']" :key="k" :value="k">{{ t(`admin.docs.expectedKinds.${k}`) }}</option></select></div>
          <div v-if="f.expectedValue.kind !== 'none'" class="sm:col-span-2"><label class="label !text-xs" :for="`fev-${i}`">{{ t('admin.docs.expectedValue') }}</label>
            <input :id="`fev-${i}`" v-model.trim="f.expectedValue.value" class="input" :placeholder="f.expectedValue.kind === 'date' ? '2026-03-15' : '1650000'" /></div>
        </template>
        <details v-else class="sm:col-span-4" :open="f.options.length > 0">
          <summary class="cursor-pointer text-sm font-semibold text-brand">{{ t('admin.docs.options') }}</summary>
          <p class="mt-1 text-xs text-ink-mute">{{ t('admin.docs.optionsHint') }}</p>
          <div v-for="(o, oi) in f.options" :key="oi" class="mt-2 flex items-center gap-2">
            <input v-model="o.text" class="input" :aria-label="t('admin.docs.optionText')" />
            <label class="flex shrink-0 items-center gap-1.5 text-sm"><input v-model="o.correct" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.docs.optionSafe') }}</label>
            <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.options.splice(oi, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <button v-if="f.options.length < 4" type="button" class="btn btn-link mt-1 !px-0" @click="f.options.push({ text: '', correct: !f.options.length })"><Icon name="plus" :size="15" /> {{ t('admin.docs.addOption') }}</button>
        </details>
        <button type="button" class="btn btn-link !px-0 text-bad sm:col-span-4 justify-start" @click="d.flaws.splice(i, 1)">{{ t('common.delete') }}</button>
      </div>
    </section>

    <!-- Markup: counterparty edits (review_fix_check) -->
    <section v-if="!isAct" class="card p-5">
      <h2 class="font-bold">{{ t('admin.docs.edits') }} <span class="text-ink-mute">· {{ d.counterpartyEdits.length }}</span></h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.docs.editsHint') }}</p>
      <div v-for="(e, i) in d.counterpartyEdits" :key="i" class="mt-3 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2" :class="{ 'border-bad': !found(e.quote) }">
        <div><label class="label !text-xs" :for="`eq-${i}`">{{ t('admin.docs.quote') }} <span v-if="!found(e.quote)" class="font-normal text-bad-dark">· {{ t('admin.docs.quoteMissing') }}</span></label>
          <textarea :id="`eq-${i}`" v-model="e.quote" class="input text-sm" rows="2" /></div>
        <div><label class="label !text-xs" :for="`er-${i}`">{{ t('admin.docs.replacement') }}</label>
          <textarea :id="`er-${i}`" v-model="e.replacement" class="input text-sm" rows="2" /></div>
        <div><label class="label !text-xs" :for="`eb-${i}`">{{ t('admin.docs.hurts') }}</label>
          <select :id="`eb-${i}`" v-model="e.badFor" class="input"><option value="none">{{ t('admin.docs.none') }}</option><option value="both">{{ t('admin.docs.both') }}</option><option v-for="p in d.parties" :key="p.key" :value="p.key">{{ p.name.ru || p.key }}</option></select></div>
        <LocalizedField v-model="e.explanation" class="sm:col-span-2" :label="t('admin.docs.explanation')" multiline :rows="2" />
        <button type="button" class="btn btn-link !px-0 text-bad justify-start" @click="d.counterpartyEdits.splice(i, 1)">{{ t('common.delete') }}</button>
      </div>
    </section>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import LocalizedField from '@/components/ui/LocalizedField.vue'
import { apiClient, apiErrorCode, LLM_TIMEOUT } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'
import UsedBy from '@/components/ui/UsedBy.vue'

// embedded: opened in the side panel of a template editor; saving reports the id instead of changing the page
const props = defineProps<{ id: string; embedded?: boolean }>()
const emit = defineEmits<{ saved: [entity: { id: string; title: string }]; deleted: [] }>()
const createdId = ref('')
const docId = computed(() => createdId.value || props.id)
const { t, te } = useI18n()
const router = useRouter()
const isNew = computed(() => docId.value === 'new')
const types = ['contract', 'labor_contract', 'admin_act', 'court_act', 'claim']
const L = () => ({ ru: '', uz: '' })

const d = reactive<any>({
  type: 'contract', title: '', language: 'ru', script: 'latn', text: '', status: 'draft', source: 'manual',
  parties: [{ key: 'customer', name: { ru: 'Заказчик', uz: 'Buyurtmachi' } }, { key: 'contractor', name: { ru: 'Подрядчик', uz: 'Pudratchi' } }],
  flaws: [], counterpartyEdits: [], segments: [], caseNumber: '', actType: '', instance: '', originalId: null
})
const isAct = computed(() => d.type === 'court_act')
// TCH-5: teachers edit their own documents and send them for review
const route = useRoute()
const teacherMode = computed(() => route.path.startsWith('/teacher'))
const base = computed(() => (teacherMode.value ? '/teacher/content' : '/admin'))
const listPath = computed(() => (teacherMode.value ? '/teacher/content' : '/admin/documents'))
const statuses = computed(() => (teacherMode.value ? ['draft', 'review'] : ['draft', 'review', 'published']))
const segmentKeys = ['case_number', 'court', 'act_type', 'subject', 'place_date', 'intro', 'reasoning', 'resolution_keyword', 'operative', 'judges']
const flawExtras = (f: any) => ({
  segmentKey: f.segmentKey ?? '',
  expectedValue: { kind: f.expectedValue?.kind ?? 'none', value: f.expectedValue?.value ?? '' },
  options: (f.options ?? []).map((o: any) => ({ text: o.text, correct: Boolean(o.correct) }))
})
const errors = ref<string[]>([])
const busy = ref(false)
const previewEl = ref<HTMLElement | null>(null)
const selection = ref('')

// Reloaded when the id changes: the AI copy of an act opens in the same view
async function load() {
  if (isNew.value) {
    // Text extracted from a DOCX on the documents page (ADM-8)
    try {
      const imported = sessionStorage.getItem('lh-docx-import')
      if (imported) {
        const x = JSON.parse(imported)
        Object.assign(d, { title: x.title ?? '', text: x.text ?? '' })
        sessionStorage.removeItem('lh-docx-import')
      }
    } catch { /* storage unavailable */ }
    return
  }
  const { data } = await apiClient.get(`${base.value}/documents/${docId.value}`)
  const doc = data.document
  Object.assign(d, {
    ...doc,
    flaws: (doc.flaws ?? []).map((f: any) => ({ quote: f.quote, type: f.type, severity: f.severity, badFor: f.badFor, normRef: f.normRef, explanation: f.explanation ?? L(), fix: f.fix ?? L(), ...flawExtras(f) })),
    segments: (doc.segments ?? []).map((x: any) => ({ key: x.key, startQuote: x.startQuote })),
    caseNumber: doc.caseNumber ?? '', actType: doc.actType ?? '', instance: doc.instance ?? '', originalId: doc.originalId ?? null,
    counterpartyEdits: (doc.counterpartyEdits ?? []).map((e: any) => ({ quote: e.quote, replacement: e.replacement, badFor: e.badFor, explanation: e.explanation ?? L() }))
  })
}
onMounted(load)
watch(() => props.id, () => { createdId.value = ''; load() })

// The server checks that each quote occurs exactly once; here a missing quote is only highlighted
const found = (q: string) => Boolean(q) && d.text.includes(q)
const segments = computed(() => {
  const marks: { start: number; end: number; kind: string; label: string }[] = []
  for (const f of d.flaws) { const i = f.quote ? d.text.indexOf(f.quote) : -1; if (i >= 0) marks.push({ start: i, end: i + f.quote.length, kind: 'flaw', label: f.type }) }
  for (const e of d.counterpartyEdits) { const i = e.quote ? d.text.indexOf(e.quote) : -1; if (i >= 0) marks.push({ start: i, end: i + e.quote.length, kind: 'edit', label: e.replacement }) }
  marks.sort((a, b) => a.start - b.start)
  const out: { start: number; end: number; kind: string; label: string }[] = []
  let pos = 0
  for (const m of marks) {
    if (m.start < pos) continue
    if (m.start > pos) out.push({ start: pos, end: m.start, kind: 'plain', label: '' })
    out.push(m)
    pos = m.end
  }
  if (pos < d.text.length) out.push({ start: pos, end: d.text.length, kind: 'plain', label: '' })
  return out
})

function captureSelection() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  selection.value = sel && previewEl.value && sel.anchorNode && previewEl.value.contains(sel.anchorNode) ? text : ''
}
function addFlaw() {
  d.flaws.push({ quote: selection.value, type: '', severity: 'medium', badFor: 'both', normRef: '', explanation: L(), fix: L(), ...flawExtras({}) })
  selection.value = ''
}
function addSegment() {
  const used = new Set(d.segments.map((x: any) => x.key))
  d.segments.push({ key: segmentKeys.find(k => !used.has(k)) ?? 'reasoning', startQuote: selection.value.slice(0, 120) })
  selection.value = ''
}

const inject = reactive({ errorsCount: 3, difficulty: 3 })
const injecting = ref(false)
// The AI copy is saved as a new draft; the original stays the reference for corrections
async function injectErrors() {
  injecting.value = true
  try {
    const { data, status } = await apiClient.post(`/admin/documents/${docId.value}/inject-errors`, inject, { timeout: LLM_TIMEOUT })
    // Sent with the next batch: the copy with errors appears in the documents list when it is ready
    if (status === 202) {
      toast(t('ai.queuedAct'), 'ok', 6000)
      return
    }
    toast(data.dropped.flaws ? t('admin.docs.injectDropped', { n: data.dropped.flaws }) : t('admin.docs.injectDone'), 'ok')
    router.push(`/admin/documents/${data.document._id}`)
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    injecting.value = false
  }
}
function addEdit() {
  d.counterpartyEdits.push({ quote: selection.value, replacement: '', badFor: 'none', explanation: L() })
  selection.value = ''
}

async function save() {
  busy.value = true
  errors.value = []
  const body = {
    type: d.type, title: d.title, language: d.language, script: d.script, text: d.text, parties: d.parties, flaws: d.flaws,
    counterpartyEdits: isAct.value ? [] : d.counterpartyEdits, status: d.status,
    segments: isAct.value ? d.segments : [], caseNumber: d.caseNumber, actType: d.actType, instance: d.instance, originalId: d.originalId
  }
  try {
    if (isNew.value) {
      const { data } = await apiClient.post(`${base.value}/documents`, body)
      emit('saved', { id: String(data.document._id), title: d.title })
      if (props.embedded) createdId.value = String(data.document._id)
      else router.replace(`${teacherMode.value ? '/teacher' : '/admin'}/documents/${data.document._id}`)
    } else {
      await apiClient.put(`${base.value}/documents/${docId.value}`, body)
      emit('saved', { id: docId.value, title: d.title })
    }
    toast(t('common.saved'), 'ok')
  } catch (e: any) {
    const err = e?.response?.data?.error
    errors.value = Array.isArray(err?.details) ? err.details.map((x: any) => `${(x.path ?? []).join('.')}: ${x.message}`) : [err?.message || t('errors.generic')]
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!window.confirm(t('admin.docs.confirmDelete'))) return
  try {
    const { data } = await apiClient.delete(`${base.value}/documents/${docId.value}`)
    toast(data.archived ? t('admin.docs.archived') : t('common.deleted'), 'ok')
    emit('deleted')
    if (!props.embedded) router.push(listPath.value)
  } catch {
    toast(t('teacher.content.cannotDelete'), 'bad')
  }
}
</script>
