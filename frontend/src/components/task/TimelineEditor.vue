<template>
  <div class="flex flex-col gap-4">
    <!-- The case package: documents with dates; a violation is marked on the event -->
    <div class="card p-5">
      <span class="eyebrow">{{ t('timeline.events') }}</span>
      <p v-if="!readonly" class="mt-2 text-sm text-ink-mute">{{ t('timeline.eventsHint') }}</p>
      <ol class="mt-4 flex flex-col gap-3">
        <li v-for="e in events" :key="e.key" class="rounded-xl border p-4" :class="violation(e.key) ? 'border-bad/40 bg-bad-soft/40' : 'border-line'">
          <div class="flex flex-wrap items-center gap-2">
            <span class="chip chip-outline">{{ ruDate(e.date) }}</span>
            <span class="font-semibold">{{ e.title }}</span>
            <span v-if="statusOf(e.key)" class="chip" :class="statusOf(e.key) === 'found' ? 'chip-ok' : statusOf(e.key) === 'missed' ? 'chip-warn' : 'bg-bad-soft text-bad-dark'">{{ t(`timeline.status.${statusOf(e.key)}`) }}</span>
          </div>
          <p v-if="e.text" class="doc-text mt-2 text-sm text-ink-soft">{{ e.text }}</p>
          <label class="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" :disabled="readonly" :checked="Boolean(violation(e.key))" @change="toggleViolation(e.key, ($event.target as HTMLInputElement).checked)" />
            {{ t('timeline.markViolation') }}
          </label>
          <textarea v-if="violation(e.key)" class="input mt-2 text-sm" rows="2" :readonly="readonly" :placeholder="t('timeline.violationHint')"
            :value="violation(e.key)!.explanation" @input="setViolation(e.key, ($event.target as HTMLTextAreaElement).value)" />
        </li>
      </ol>
    </div>

    <!-- Deadlines: from which event, the last day and the calculation -->
    <div class="card p-5">
      <span class="eyebrow">{{ t('timeline.deadlines') }}</span>
      <p class="mt-2 text-sm text-ink-mute">{{ checks.length ? t('timeline.deadlinesGiven') : t('timeline.deadlinesFree') }}</p>
      <div v-for="(r, i) in modelValue.deadlines" :key="i" class="mt-3 grid gap-3 rounded-xl border border-line p-4 md:grid-cols-2">
        <div>
          <label class="label !text-xs" :for="`tl-from-${i}`">{{ t('timeline.from') }}</label>
          <select :id="`tl-from-${i}`" class="input" :disabled="readonly || isGiven(i)" :value="r.fromEventKey" @change="setRow(i, { fromEventKey: val($event) })">
            <option value="" disabled>-</option>
            <option v-for="e in events" :key="e.key" :value="e.key">{{ ruDate(e.date) }} - {{ e.title }}</option>
          </select>
        </div>
        <div>
          <label class="label !text-xs" :for="`tl-label-${i}`">{{ t('timeline.label') }}</label>
          <input :id="`tl-label-${i}`" class="input" :readonly="readonly || isGiven(i)" :value="r.label" @input="setRow(i, { label: val($event) })" />
        </div>
        <div>
          <label class="label !text-xs" :for="`tl-end-${i}`">{{ t('timeline.endDate') }}</label>
          <input :id="`tl-end-${i}`" type="date" class="input" :readonly="readonly" :value="r.endDate" @input="setRow(i, { endDate: val($event) })" />
          <slot name="row-extra" :index="i" />
        </div>
        <div>
          <label class="label !text-xs" :for="`tl-calc-${i}`">{{ t('timeline.calc') }}</label>
          <textarea :id="`tl-calc-${i}`" class="input" rows="2" :readonly="readonly" :placeholder="t('process.calcHint')" :value="r.calc" @input="setRow(i, { calc: val($event) })" />
        </div>
        <button v-if="!readonly && !isGiven(i)" type="button" class="btn btn-link !px-0 text-bad justify-start md:col-span-2" @click="removeRow(i)">{{ t('common.delete') }}</button>
      </div>
      <button v-if="!readonly && modelValue.deadlines.length < 20" type="button" class="btn btn-ghost mt-3" @click="addRow"><Icon name="plus" :size="16" /> {{ t('timeline.addDeadline') }}</button>
    </div>

    <div class="card p-5">
      <label class="eyebrow block" for="tl-summary">{{ t('timeline.summary') }}</label>
      <textarea id="tl-summary" class="input mt-3" rows="3" :readonly="readonly" :placeholder="t('timeline.summaryHint')" :value="modelValue.summary" @input="emitValue({ summary: val($event) })" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

export interface TimelineRow { fromEventKey: string; label: string; endDate: string; calc: string }
export interface TimelineAnswer { deadlines: TimelineRow[]; violations: { eventKey: string; explanation: string }[]; summary: string }

const props = withDefaults(defineProps<{
  modelValue: TimelineAnswer
  events: { key: string; title: string; date: string; text: string }[]
  // Deadlines named by the task on levels 1-2: their rows are prefilled and fixed
  checks?: { key: string; label: string; fromEventKey: string }[]
  readonly?: boolean
  // Result view: event key -> found / missed / extra
  violationStatus?: Record<string, string>
}>(), { checks: () => [], readonly: false, violationStatus: () => ({}) })
const emit = defineEmits<{ 'update:modelValue': [value: TimelineAnswer] }>()
const { t } = useI18n()

const ruDate = (s: string) => (s ? s.split('-').reverse().join('.') : '')
const val = (e: Event) => (e.target as HTMLInputElement).value
const emitValue = (patch: Partial<TimelineAnswer>) => emit('update:modelValue', { ...props.modelValue, ...patch })
const setRow = (i: number, patch: Partial<TimelineRow>) => emitValue({ deadlines: props.modelValue.deadlines.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
const addRow = () => emitValue({ deadlines: [...props.modelValue.deadlines, { fromEventKey: '', label: '', endDate: '', calc: '' }] })
const removeRow = (i: number) => emitValue({ deadlines: props.modelValue.deadlines.filter((_, j) => j !== i) })
const isGiven = (i: number) => i < props.checks.length
const violation = (key: string) => props.modelValue.violations.find(v => v.eventKey === key)
const statusOf = (key: string) => props.violationStatus[key]
function toggleViolation(key: string, on: boolean) {
  emitValue({ violations: on ? [...props.modelValue.violations, { eventKey: key, explanation: '' }] : props.modelValue.violations.filter(v => v.eventKey !== key) })
}
const setViolation = (key: string, explanation: string) => emitValue({ violations: props.modelValue.violations.map(v => (v.eventKey === key ? { ...v, explanation } : v)) })

// Rows of the named deadlines come first, in the order of the task
onMounted(() => {
  if (props.readonly || !props.checks.length) return
  const rows = props.modelValue.deadlines
  if (props.checks.every((c, i) => rows[i]?.fromEventKey === c.fromEventKey)) return
  emitValue({ deadlines: [...props.checks.map(c => ({ fromEventKey: c.fromEventKey, label: c.label, endDate: '', calc: '' })), ...rows.filter(r => !props.checks.some(c => c.fromEventKey === r.fromEventKey && c.label === r.label))] })
})
</script>
