<template>
  <div class="flex flex-col gap-4">
    <!-- Package of documents (PRD 4.8): one tab per document with its fill progress -->
    <div v-if="documents.length > 1" class="flex flex-wrap gap-2" role="tablist">
      <button v-for="d in documents" :key="d.id" type="button" role="tab" class="filter" :class="{ 'is-active': activeDoc === d.id }" :aria-selected="activeDoc === d.id" @click="selectDoc(d.id)">
        {{ d.title }} <span class="ml-1 text-xs opacity-70">{{ filledIn(d.id) }}/{{ fields.length }}</span>
      </button>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <!-- Document: select a fragment to make it the source of a term -->
      <div class="card min-w-0 p-5">
        <span class="eyebrow">{{ doc?.title }}</span>
        <p v-if="!readonly" class="mt-2 text-sm text-ink-mute">{{ t('extraction.selectHint') }}</p>
        <div ref="docEl" class="doc-text mt-4 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white p-4 leading-8" @mouseup="onSelect" @keyup="onSelect">
          <template v-for="seg in segments" :key="seg.start">
            <mark v-if="seg.mark" :data-start="seg.start" class="bg-brand-soft text-ink">{{ doc!.text.slice(seg.start, seg.end) }}</mark>
            <span v-else :data-start="seg.start">{{ doc!.text.slice(seg.start, seg.end) }}</span>
          </template>
        </div>
      </div>

      <!-- Terms of the active document -->
      <div class="flex min-w-0 flex-col gap-3">
        <div v-if="pending && !readonly" class="card border-brand/40 bg-brand-tint p-4">
          <div class="text-xs font-semibold text-ink-mute">{{ t('extraction.selected') }}</div>
          <p class="mt-1 line-clamp-3 text-sm italic">«{{ pending.quote }}»</p>
          <label class="label mt-3 !text-xs" for="ex-target">{{ t('extraction.sourceFor') }}</label>
          <select id="ex-target" v-model="pendingField" class="input !py-1.5 text-sm">
            <option v-for="f in fields" :key="f.key" :value="f.key">{{ f.label }}</option>
          </select>
          <div class="mt-3 flex gap-2">
            <button type="button" class="btn btn-primary !min-h-9 text-sm" @click="applyPending"><Icon name="check" :size="16" /> {{ t('extraction.setSource') }}</button>
            <button type="button" class="btn btn-ghost !min-h-9 text-sm" @click="pending = null">{{ t('common.cancel') }}</button>
          </div>
        </div>
        <p v-if="selectError" class="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn-dark">{{ selectError }}</p>

        <div v-for="f in fields" :key="f.key" class="card p-4" :class="activeField === f.key ? 'border-brand' : ''" @click="activeField = f.key">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold">{{ f.label }}</div>
              <div v-if="f.hint" class="text-xs text-ink-mute">{{ f.hint }}</div>
            </div>
            <span v-if="result(f.key)" class="chip shrink-0" :class="statusClass(result(f.key)!.status)">{{ t(`extraction.status.${result(f.key)!.status}`) }}</span>
          </div>

          <template v-if="readonly">
            <p class="mt-2 text-sm">{{ cell(f.key)?.absent ? t('extraction.absent') : shown(f.kind, cell(f.key)?.value) || '-' }}</p>
          </template>
          <template v-else>
            <label class="sr-only" :for="`v-${f.key}`">{{ f.label }}</label>
            <select v-if="f.kind === 'bool'" :id="`v-${f.key}`" class="input mt-2 !py-1.5 text-sm" :disabled="cell(f.key)?.absent" :value="cell(f.key)?.value ?? ''" @change="set(f.key, { value: ($event.target as HTMLSelectElement).value })">
              <option value="">-</option><option value="yes">{{ t('extraction.yes') }}</option><option value="no">{{ t('extraction.no') }}</option>
            </select>
            <input v-else-if="f.kind === 'date'" :id="`v-${f.key}`" type="date" class="input mt-2 !py-1.5 text-sm" :disabled="cell(f.key)?.absent" :value="cell(f.key)?.value ?? ''" @input="set(f.key, { value: ($event.target as HTMLInputElement).value })" />
            <input v-else-if="f.kind === 'money'" :id="`v-${f.key}`" inputmode="numeric" class="input mt-2 !py-1.5 text-sm" :placeholder="t('extraction.moneyHint')" :disabled="cell(f.key)?.absent" :value="cell(f.key)?.value ?? ''" @input="set(f.key, { value: ($event.target as HTMLInputElement).value })" />
            <textarea v-else :id="`v-${f.key}`" rows="2" class="input mt-2 !py-1.5 text-sm" :placeholder="t('extraction.textHint')" :disabled="cell(f.key)?.absent" :value="cell(f.key)?.value ?? ''" @input="set(f.key, { value: ($event.target as HTMLTextAreaElement).value })" />
            <label class="mt-2 flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" :checked="cell(f.key)?.absent ?? false" @change="set(f.key, { absent: ($event.target as HTMLInputElement).checked })" /> {{ t('extraction.absent') }}
            </label>
          </template>

          <div v-if="!cell(f.key)?.absent" class="mt-2 text-xs">
            <template v-if="cell(f.key)?.quote">
              <span class="text-ink-mute">{{ t('extraction.source') }}:</span>
              <button type="button" class="ml-1 italic text-brand-dark underline-offset-2 hover:underline" @click.stop="showSource(f.key)">«{{ short(cell(f.key)!.quote) }}»</button>
              <button v-if="!readonly" type="button" class="ml-2 text-bad" :aria-label="t('extraction.clearSource')" @click.stop="set(f.key, { quote: '', from: null, to: null })"><Icon name="x" :size="13" /></button>
            </template>
            <span v-else-if="!readonly" class="text-ink-mute">{{ t('extraction.noSource') }}</span>
            <span v-if="result(f.key) && result(f.key)!.needsSource && !result(f.key)!.sourceOk" class="ml-2 font-semibold text-warn-dark">{{ t('extraction.sourceMissing') }}</span>
          </div>

          <!-- Result: AI comment on a text term and the reference once it opens -->
          <p v-if="comment(f.key)" class="mt-2 text-sm text-ink-soft">{{ comment(f.key) }}</p>
          <div v-if="result(f.key)?.expected" class="mt-2 rounded-lg bg-ok-soft p-2 text-sm text-ok-dark">
            <b>{{ t('extraction.reference') }}:</b> {{ result(f.key)!.expected!.absent ? t('extraction.absent') : shown(f.kind, result(f.key)!.expected!.value) }}
            <span v-if="result(f.key)!.expected!.quote" class="block text-xs italic">«{{ short(result(f.key)!.expected!.quote, 160) }}»</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

export interface ExtractionCell { documentId: string; fieldKey: string; value: string; absent: boolean; quote: string; from: number | null; to: number | null }
export interface ExtractionField { key: string; label: string; kind: 'text' | 'date' | 'money' | 'bool'; hint?: string }
export interface ExtractionDoc { id: string; title: string; text: string }
export interface CellResult { status: string; sourceOk: boolean; needsSource: boolean; expected: { value: string; absent: boolean; quote: string } | null; comment?: string }

const props = withDefaults(defineProps<{
  documents: ExtractionDoc[]
  fields: ExtractionField[]
  modelValue: ExtractionCell[]
  readonly?: boolean
  // Result view: "documentId|fieldKey" -> status, source check, reference
  results?: Record<string, CellResult>
}>(), { readonly: false, results: () => ({}) })
const emit = defineEmits<{ 'update:modelValue': [cells: ExtractionCell[]] }>()
const { t } = useI18n()

const activeDoc = ref(props.documents[0]?.id ?? '')
const activeField = ref(props.fields[0]?.key ?? '')
const doc = computed(() => props.documents.find(d => d.id === activeDoc.value))
const docEl = ref<HTMLElement | null>(null)
const pending = ref<{ from: number; to: number; quote: string } | null>(null)
const pendingField = ref('')
const selectError = ref('')

const keyOf = (documentId: string, fieldKey: string) => `${documentId}|${fieldKey}`
const cell = (fieldKey: string) => props.modelValue.find(c => c.documentId === activeDoc.value && c.fieldKey === fieldKey)
const result = (fieldKey: string) => props.results[keyOf(activeDoc.value, fieldKey)]
const comment = (fieldKey: string) => result(fieldKey)?.comment ?? ''
const filledIn = (documentId: string) => props.modelValue.filter(c => c.documentId === documentId && (c.absent || c.value.trim())).length

function set(fieldKey: string, patch: Partial<ExtractionCell>) {
  if (props.readonly) return
  const blank: ExtractionCell = { documentId: activeDoc.value, fieldKey, value: '', absent: false, quote: '', from: null, to: null }
  const current = cell(fieldKey) ?? blank
  const next = { ...current, ...patch }
  // "Not in the document" has no value and no source
  if (patch.absent) Object.assign(next, { value: '', quote: '', from: null, to: null })
  const rest = props.modelValue.filter(c => !(c.documentId === activeDoc.value && c.fieldKey === fieldKey))
  emit('update:modelValue', [...rest, next])
}

function selectDoc(id: string) {
  activeDoc.value = id
  pending.value = null
  selectError.value = ''
}

// The active term's source is highlighted in the text
const segments = computed(() => {
  const len = doc.value?.text.length ?? 0
  const c = cell(activeField.value)
  if (!c || c.from == null || c.to == null || c.to > len) return [{ start: 0, end: len, mark: false }]
  return [{ start: 0, end: c.from, mark: false }, { start: c.from, end: c.to, mark: true }, { start: c.to, end: len, mark: false }].filter(s => s.end > s.start)
})

function showSource(fieldKey: string) {
  activeField.value = fieldKey
  requestAnimationFrame(() => docEl.value?.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

// Text offset of a DOM position: every span of the document carries data-start
function offsetOf(node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE) return null
  const host = node.parentElement?.closest('[data-start]') as HTMLElement | null
  if (!host || !docEl.value?.contains(host)) return null
  return Number(host.dataset.start) + offset
}

function onSelect() {
  if (props.readonly || !doc.value) return
  selectError.value = ''
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  let from = offsetOf(range.startContainer, range.startOffset)
  let to = offsetOf(range.endContainer, range.endOffset)
  if (from == null || to == null) { selectError.value = t('extraction.selectInside'); return }
  if (from > to) [from, to] = [to, from]
  const text = doc.value.text
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  if (to - from < 2) return
  pending.value = { from, to, quote: text.slice(from, to) }
  pendingField.value = activeField.value || props.fields[0]?.key || ''
}

function applyPending() {
  if (!pending.value || !pendingField.value) return
  const c = cell(pendingField.value)
  set(pendingField.value, { ...pending.value, absent: false, value: c?.absent ? '' : c?.value ?? '' })
  activeField.value = pendingField.value
  pending.value = null
  window.getSelection()?.removeAllRanges()
}

// Touch screens finish a selection without mouseup
let selTimer: ReturnType<typeof setTimeout> | null = null
function onSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.anchorNode || !docEl.value?.contains(sel.anchorNode)) return
  if (selTimer) clearTimeout(selTimer)
  selTimer = setTimeout(onSelect, 350)
}
onMounted(() => { if (!props.readonly) document.addEventListener('selectionchange', onSelectionChange) })
onBeforeUnmount(() => { document.removeEventListener('selectionchange', onSelectionChange); if (selTimer) clearTimeout(selTimer) })

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}...` : s)
const shown = (kind: string, v?: string) => {
  if (!v) return ''
  if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('.')
  if (kind === 'bool') return v === 'yes' ? t('extraction.yes') : v === 'no' ? t('extraction.no') : v
  if (kind === 'money' && /^\d[\d\s]*$/.test(v)) return Number(v.replace(/\s/g, '')).toLocaleString('ru-RU')
  return v
}
const statusClass = (s: string) => ({ correct: 'chip-ok', partial: 'chip-warn', wrong: 'chip-bad', empty: 'chip-muted' }[s] ?? 'chip-muted')
</script>
