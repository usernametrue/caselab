<template>
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div class="card min-w-0 p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="eyebrow">{{ title || t('review.document') }}</span>
        <div class="flex flex-wrap gap-2">
          <span v-if="flawCount != null" class="chip chip-warn">{{ t('mines.count', { n: flawCount }) }}</span>
          <span v-if="falseClicks" class="chip bg-bad-soft text-bad-dark">{{ t('mines.falseClicks', { n: falseClicks }) }}</span>
          <span v-if="timerSec" class="chip" :class="secondsLeft <= 60 ? 'bg-bad-soft text-bad-dark' : 'chip-outline'"><Icon name="clock" :size="13" /> {{ clock }}</span>
        </div>
      </div>
      <p v-if="!readonly" class="mt-2 text-sm text-ink-mute">{{ t('mines.hint') }}</p>
      <div class="doc-text mt-4 rounded-xl border border-line bg-white p-4 leading-8">
        <template v-for="part in parts" :key="part.from">
          <span v-if="part.segment == null">{{ text.slice(part.from, part.to) }}</span>
          <button v-else type="button" class="rounded-md px-0.5 text-left transition-colors"
            :class="segmentClass(part.segment)" :disabled="readonly || timeOver || clickedState(part.segment) === 'safe' || busy"
            :aria-label="t('mines.openPhrase')" @click="click(part.segment)">{{ text.slice(part.from, part.to) }}</button>
        </template>
      </div>
    </div>

    <div class="flex min-w-0 flex-col gap-3">
      <p v-if="timeOver && !readonly" class="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ t('mines.timeOver') }}</p>
      <p v-if="!found.length" class="card p-4 text-sm text-ink-mute">{{ readonly ? t('mines.noneFound') : t('mines.empty') }}</p>
      <div v-for="seg in found" :key="seg" class="card p-4" :class="activeSegment === seg ? 'border-brand' : ''">
        <div class="flex items-start gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-bad-soft text-xs font-bold text-bad-dark">!</span>
          <p class="line-clamp-3 flex-1 text-sm italic text-ink-soft">«{{ phrase(seg) }}»</p>
        </div>
        <slot name="item-extra" :index="itemIndex(seg)" />
        <template v-if="options[seg]?.length">
          <fieldset class="mt-3 flex flex-col gap-1.5">
            <legend class="label !text-xs">{{ t('mines.chooseReplacement') }}</legend>
            <label v-for="(o, oi) in options[seg]" :key="oi" class="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm"
              :class="item(seg)?.optionIndex === oi ? 'border-brand bg-brand-tint' : 'border-line'">
              <input type="radio" class="mt-1 accent-[var(--brand)]" :name="`mo-${seg}`" :disabled="readonly" :checked="item(seg)?.optionIndex === oi" @change="update(seg, { optionIndex: oi, replacement: o })" />
              <span>{{ o }}</span>
            </label>
          </fieldset>
        </template>
        <template v-else>
          <label class="label mt-3 !text-xs" :for="`mr-${seg}`">{{ t('mines.replacement') }}</label>
          <textarea :id="`mr-${seg}`" class="input !py-2 text-sm" rows="2" :readonly="readonly" :value="item(seg)?.replacement ?? ''" @input="update(seg, { replacement: val($event) })" />
        </template>
        <label class="label mt-2 !text-xs" :for="`md-${seg}`">{{ t('mines.danger') }}</label>
        <input :id="`md-${seg}`" class="input !py-2 text-sm" :readonly="readonly" :placeholder="t('mines.dangerHint')" :value="item(seg)?.danger ?? ''" @input="update(seg, { danger: val($event) })" />
      </div>
      <p v-if="error" class="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad-dark">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'

export interface MineItem { segment: number; replacement: string; danger: string; optionIndex: number | null }

const props = withDefaults(defineProps<{
  instanceId: string
  text: string
  title?: string
  segments: { from: number; to: number }[]
  clicks: { segment: number; mine: boolean }[]
  modelValue: MineItem[]
  flawCount?: number | null
  timerSec?: number
  startedAt?: string | null
  readonly?: boolean
  // Result view: segment -> found / wrong option
  statuses?: Record<number, string>
}>(), { title: '', flawCount: null, timerSec: 0, startedAt: null, readonly: false, statuses: () => ({}) })
const emit = defineEmits<{ 'update:modelValue': [items: MineItem[]]; timeout: [] }>()
const { t, te } = useI18n()

// Clicks made in this session plus the ones the server already knows; options come with a click on a mine
const clicked = ref(new Map(props.clicks.map(c => [c.segment, c.mine ? 'mine' : 'safe'])))
const options = ref<Record<number, string[]>>({})
const busy = ref(false)
const error = ref('')
const activeSegment = ref<number | null>(null)
const OPTIONS_KEY = `lh-mine-options-${props.instanceId}`
try { options.value = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}') } catch { /* storage unavailable */ }

const clickedState = (s: number) => clicked.value.get(s)
const falseClicks = computed(() => [...clicked.value.values()].filter(v => v === 'safe').length)
const found = computed(() => [...clicked.value.entries()].filter(([, v]) => v === 'mine').map(([s]) => s).sort((a, b) => a - b))

const parts = computed(() => {
  const out: { from: number; to: number; segment: number | null }[] = []
  let pos = 0
  props.segments.forEach((s, i) => {
    if (s.from > pos) out.push({ from: pos, to: s.from, segment: null })
    out.push({ from: s.from, to: s.to, segment: i })
    pos = s.to
  })
  if (pos < props.text.length) out.push({ from: pos, to: props.text.length, segment: null })
  return out
})
const phrase = (s: number) => props.text.slice(props.segments[s].from, props.segments[s].to)
function segmentClass(s: number) {
  const st = props.statuses[s]
  if (st === 'missed') return 'bg-warn-soft ring-1 ring-warn/40'
  const c = clickedState(s)
  if (c === 'mine') return activeSegment.value === s ? 'bg-bad-soft text-bad-dark ring-2 ring-bad/40' : 'bg-bad-soft text-bad-dark'
  if (c === 'safe') return 'bg-paper text-ink-mute line-through decoration-ink-mute/40'
  return props.readonly ? '' : 'hover:bg-brand-tint'
}

const item = (s: number) => props.modelValue.find(i => i.segment === s)
const itemIndex = (s: number) => props.modelValue.findIndex(i => i.segment === s)
const val = (e: Event) => (e.target as HTMLInputElement).value
function update(s: number, patch: Partial<MineItem>) {
  const exists = item(s)
  const items = exists
    ? props.modelValue.map(i => (i.segment === s ? { ...i, ...patch } : i))
    : [...props.modelValue, { segment: s, replacement: '', danger: '', optionIndex: null, ...patch }]
  emit('update:modelValue', items)
}

async function click(s: number) {
  activeSegment.value = s
  if (clickedState(s)) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await apiClient.post(`/tasks/instances/${props.instanceId}/mines/click`, { segment: s })
    clicked.value.set(s, data.mine ? 'mine' : 'safe')
    clicked.value = new Map(clicked.value)
    if (data.mine) {
      if (data.options?.length) {
        options.value = { ...options.value, [s]: data.options }
        try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options.value)) } catch { /* storage unavailable */ }
      }
      if (!item(s)) update(s, {})
    }
  } catch (e) {
    const code = apiErrorCode(e)
    if (code === 'time_over') { timeOver.value = true; emit('timeout') }
    error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    busy.value = false
  }
}

// Optional timer of the template (PRD 4.7); the server refuses clicks once it runs out
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
const deadline = computed(() => (props.timerSec && props.startedAt ? new Date(props.startedAt).getTime() + props.timerSec * 1000 : null))
const secondsLeft = computed(() => (deadline.value ? Math.max(0, Math.round((deadline.value - now.value) / 1000)) : 0))
const timeOver = ref(false)
const clock = computed(() => `${Math.floor(secondsLeft.value / 60)}:${String(secondsLeft.value % 60).padStart(2, '0')}`)
watch(secondsLeft, v => { if (deadline.value && v === 0 && !timeOver.value && !props.readonly) { timeOver.value = true; emit('timeout') } })
onMounted(() => { if (deadline.value && !props.readonly) tick = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (tick) clearInterval(tick) })
</script>
