<template>
  <div class="card p-5">
    <span class="eyebrow">{{ t('process.card') }}</span>
    <p class="mt-2 text-sm text-ink-mute">{{ t('process.hint') }}</p>
    <div class="mt-4 flex flex-col gap-4">
      <div>
        <label class="label" for="pc-action">{{ t('process.action') }}</label>
        <textarea id="pc-action" class="input" rows="3" :readonly="readonly" :placeholder="t('process.actionHint')" :value="modelValue.action" @input="set('action', val($event))" />
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <label class="label" for="pc-court">{{ t('process.court') }}</label>
          <input id="pc-court" class="input" list="pc-courts" :readonly="readonly" :value="modelValue.court" :placeholder="t('process.courtHint')" @input="set('court', val($event))" />
          <datalist id="pc-courts"><option v-for="c in courts" :key="c" :value="c" /></datalist>
        </div>
        <div>
          <label class="label" for="pc-basis">{{ t('process.courtBasis') }}</label>
          <textarea id="pc-basis" class="input" rows="2" :readonly="readonly" :value="modelValue.courtBasis" @input="set('courtBasis', val($event))" />
        </div>
        <div>
          <label class="label" for="pc-deadline">{{ t('process.deadline') }}</label>
          <input id="pc-deadline" type="date" class="input" :readonly="readonly" :value="modelValue.deadline" @input="set('deadline', val($event))" />
        </div>
        <div>
          <label class="label" for="pc-dcalc">{{ t('process.deadlineCalc') }}</label>
          <textarea id="pc-dcalc" class="input" rows="2" :readonly="readonly" :placeholder="t('process.calcHint')" :value="modelValue.deadlineCalc" @input="set('deadlineCalc', val($event))" />
        </div>
        <div>
          <label class="label" for="pc-fee">{{ t('process.fee') }}</label>
          <input id="pc-fee" type="number" min="0" step="1" class="input" :readonly="readonly" :value="modelValue.fee ?? ''" @input="setFee(val($event))" />
        </div>
        <div>
          <label class="label" for="pc-fcalc">{{ t('process.feeCalc') }}</label>
          <textarea id="pc-fcalc" class="input" rows="2" :readonly="readonly" :placeholder="t('process.calcHint')" :value="modelValue.feeCalc" @input="set('feeCalc', val($event))" />
        </div>
      </div>
      <div>
        <label class="label" for="pc-cons">{{ t('process.consequences') }}</label>
        <textarea id="pc-cons" class="input" rows="2" :readonly="readonly" :value="modelValue.consequences" @input="set('consequences', val($event))" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export interface ProcessAnswer {
  action: string; court: string; courtBasis: string; deadline: string; deadlineCalc: string
  fee: number | null; feeCalc: string; consequences: string
}

const props = withDefaults(defineProps<{ modelValue: ProcessAnswer; courts?: string[]; readonly?: boolean }>(), { courts: () => [], readonly: false })
const emit = defineEmits<{ 'update:modelValue': [value: ProcessAnswer] }>()
const { t } = useI18n()
const val = (e: Event) => (e.target as HTMLInputElement).value
const set = (key: keyof ProcessAnswer, value: string) => emit('update:modelValue', { ...props.modelValue, [key]: value })
const setFee = (v: string) => emit('update:modelValue', { ...props.modelValue, fee: v === '' ? null : Math.max(0, Math.round(Number(v))) })
</script>
