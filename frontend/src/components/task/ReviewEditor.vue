<template>
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <!-- Document: select a fragment to mark it -->
    <div class="card min-w-0 p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="eyebrow">{{ title || t('review.document') }}</span>
        <span v-if="flawCount != null" class="chip chip-warn">{{ t(`${prefix}.flawCount`, { n: flawCount }) }}</span>
      </div>
      <p v-if="!readonly" class="mt-2 text-sm text-ink-mute">{{ t(`${prefix}.selectHint`) }}</p>
      <div ref="docEl" class="doc-text mt-4 rounded-xl border border-line bg-white p-4 leading-8" @mouseup="onSelect" @keyup="onSelect">
        <template v-for="seg in segments" :key="seg.start">
          <span v-if="seg.item == null" :data-start="seg.start">{{ text.slice(seg.start, seg.end) }}</span>
          <span v-else class="cursor-pointer rounded-md transition-colors" :class="activeIndex === seg.item ? 'ring-2 ring-brand/40' : ''" @click="activeIndex = seg.item">
            <template v-if="modelValue[seg.item].replacement">
              <del :data-start="seg.start" class="bg-bad-soft text-bad-dark decoration-bad">{{ text.slice(seg.start, seg.end) }}</del>
              <ins data-skip class="select-none bg-ok-soft text-ok-dark no-underline">{{ modelValue[seg.item].replacement }}</ins>
            </template>
            <mark v-else :data-start="seg.start" class="bg-warn-soft text-ink">{{ text.slice(seg.start, seg.end) }}</mark>
            <sup data-skip class="select-none px-0.5 font-bold" :class="itemTone(seg.item)">{{ seg.item + 1 }}</sup>
          </span>
        </template>
      </div>
    </div>

    <!-- Edits -->
    <div class="flex min-w-0 flex-col gap-3">
      <div v-if="pending && !readonly" class="card border-brand/40 bg-brand-tint p-4 animate-pop">
        <div class="text-xs font-semibold text-ink-mute">{{ t('review.selected') }}</div>
        <p class="mt-1 line-clamp-3 text-sm italic">«{{ pending.quote }}»</p>
        <div class="mt-3 flex gap-2">
          <button class="btn btn-primary !min-h-9 text-sm" @click="addPending"><Icon name="plus" :size="16" /> {{ t('review.mark') }}</button>
          <button class="btn btn-ghost !min-h-9 text-sm" @click="pending = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
      <p v-if="selectError" class="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn-dark">{{ selectError }}</p>

      <p v-if="!modelValue.length && !pending" class="card p-4 text-sm text-ink-mute">{{ readonly ? t(`${prefix}.noItems`) : t(`${prefix}.empty`) }}</p>
      <div v-for="(it, i) in sortedIndexes" :key="i" class="card p-4" :class="activeIndex === it ? 'border-brand' : ''" @click="activeIndex = it">
        <div class="flex items-start gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-bold" :class="badgeClass(it)">{{ it + 1 }}</span>
          <p class="line-clamp-2 flex-1 text-sm italic text-ink-soft">«{{ modelValue[it].quote }}»</p>
          <button v-if="!readonly" class="btn-icon btn !h-8 !w-8 text-bad" :aria-label="t('common.delete')" @click.stop="remove(it)"><Icon name="trash" :size="15" /></button>
        </div>
        <slot name="item-extra" :index="it" />
        <template v-if="readonly">
          <p class="mt-2 text-sm"><b>{{ t(`${prefix}.comment`) }}:</b> {{ modelValue[it].comment }}</p>
          <p v-if="modelValue[it].replacement" class="mt-1 text-sm"><b>{{ t(`${prefix}.replacement`) }}:</b> {{ modelValue[it].replacement }}</p>
        </template>
        <template v-else>
          <label class="label mt-3 !text-xs" :for="`c-${it}`">{{ t(`${prefix}.comment`) }}</label>
          <textarea :id="`c-${it}`" class="input !py-2 text-sm" rows="3" :placeholder="t(`${prefix}.commentHint`)" :value="modelValue[it].comment"
            @input="update(it, 'comment', ($event.target as HTMLTextAreaElement).value)" />
          <label class="label mt-2 !text-xs" :for="`r-${it}`">{{ t(`${prefix}.replacement`) }}</label>
          <textarea :id="`r-${it}`" class="input !py-2 text-sm" rows="2" :placeholder="t(`${prefix}.replacementHint`)" :value="modelValue[it].replacement"
            @input="update(it, 'replacement', ($event.target as HTMLTextAreaElement).value)" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

export interface ReviewItem { from: number; to: number; quote: string; comment: string; replacement: string }

const props = withDefaults(defineProps<{
  text: string
  modelValue: ReviewItem[]
  title?: string
  flawCount?: number | null
  readonly?: boolean
  // Result view: item index -> found / extra / justified / against
  statuses?: Record<number, string>
  // Locale section for the labels: "review" for contracts, "act" for court acts
  prefix?: string
}>(), { title: '', flawCount: null, readonly: false, statuses: () => ({}), prefix: 'review' })
const emit = defineEmits<{ 'update:modelValue': [items: ReviewItem[]] }>()
const { t } = useI18n()

const docEl = ref<HTMLElement | null>(null)
const pending = ref<{ from: number; to: number; quote: string } | null>(null)
const selectError = ref('')
const activeIndex = ref<number | null>(null)

// Plain-text segments between selections; offsets refer to the original text only
const segments = computed(() => {
  const order = props.modelValue.map((it, i) => ({ ...it, i })).sort((a, b) => a.from - b.from)
  const out: { start: number; end: number; item: number | null }[] = []
  let pos = 0
  for (const it of order) {
    if (it.from > pos) out.push({ start: pos, end: it.from, item: null })
    out.push({ start: it.from, end: it.to, item: it.i })
    pos = it.to
  }
  if (pos < props.text.length) out.push({ start: pos, end: props.text.length, item: null })
  return out
})
const sortedIndexes = computed(() => props.modelValue.map((it, i) => ({ from: it.from, i })).sort((a, b) => a.from - b.from).map(x => x.i))

const toneOf = (i: number) => props.statuses[i]
const badgeClass = (i: number) => ({
  found: 'bg-ok-soft text-ok-dark', justified: 'bg-ok-soft text-ok-dark', extra: 'bg-paper text-ink-mute border border-line', against: 'bg-bad-soft text-bad-dark'
}[toneOf(i) ?? ''] ?? 'bg-brand-soft text-brand-dark')
const itemTone = (i: number) => ({ found: 'text-ok-dark', justified: 'text-ok-dark', extra: 'text-ink-mute', against: 'text-bad-dark' }[toneOf(i) ?? ''] ?? 'text-brand')

// Text offset of a DOM position: every selectable span carries data-start, inserted text is marked data-skip
function offsetOf(node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE) return null
  const el = node.parentElement
  if (!el || el.closest('[data-skip]')) return null
  const host = el.closest('[data-start]') as HTMLElement | null
  if (!host || !docEl.value?.contains(host)) return null
  return Number(host.dataset.start) + offset
}

function onSelect() {
  if (props.readonly) return
  selectError.value = ''
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  let from = offsetOf(range.startContainer, range.startOffset)
  let to = offsetOf(range.endContainer, range.endOffset)
  if (from == null || to == null) { selectError.value = t('review.selectInside'); return }
  if (from > to) [from, to] = [to, from]
  // Trim surrounding whitespace so the quote starts and ends on text
  while (from < to && /\s/.test(props.text[from])) from++
  while (to > from && /\s/.test(props.text[to - 1])) to--
  if (to - from < 2) return
  if (props.modelValue.some(it => from! < it.to && to! > it.from)) { selectError.value = t('review.overlap'); return }
  pending.value = { from, to, quote: props.text.slice(from, to) }
}

// Touch screens finish a selection without mouseup: listen to selection changes inside the document
let selTimer: ReturnType<typeof setTimeout> | null = null
function onSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.anchorNode || !docEl.value?.contains(sel.anchorNode)) return
  if (selTimer) clearTimeout(selTimer)
  selTimer = setTimeout(onSelect, 350)
}
onMounted(() => { if (!props.readonly) document.addEventListener('selectionchange', onSelectionChange) })
onBeforeUnmount(() => { document.removeEventListener('selectionchange', onSelectionChange); if (selTimer) clearTimeout(selTimer) })

function addPending() {
  if (!pending.value) return
  const items = [...props.modelValue, { ...pending.value, comment: '', replacement: '' }]
  emit('update:modelValue', items)
  activeIndex.value = items.length - 1
  pending.value = null
  window.getSelection()?.removeAllRanges()
}
function update(i: number, key: 'comment' | 'replacement', value: string) {
  emit('update:modelValue', props.modelValue.map((it, j) => (j === i ? { ...it, [key]: value } : it)))
}
function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, j) => j !== i))
  activeIndex.value = null
}
</script>
