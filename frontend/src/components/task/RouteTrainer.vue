<template>
  <div class="flex flex-col gap-4">
    <!-- Questions to the client: up to three, part of the facts comes only on request (PRD 4.5) -->
    <div class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="eyebrow">{{ t('route.askTitle') }}</span>
        <span class="chip" :class="left ? 'chip-brand' : 'chip-muted'">{{ t('route.questionsLeft', { n: left }) }}</span>
      </div>
      <p class="mt-2 text-sm text-ink-mute">{{ t('route.askHint') }}</p>
      <ul v-if="dialog.length" class="mt-4 flex flex-col gap-3">
        <li v-for="(d, i) in dialog" :key="i" class="flex flex-col gap-2">
          <div class="self-end rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-sm text-brand-dark sm:max-w-[80%]">{{ d.question }}</div>
          <div class="flex gap-2 sm:max-w-[85%]">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sun text-xs font-bold text-ink"><Icon name="user" :size="15" /></span>
            <div class="rounded-2xl rounded-tl-md bg-paper px-4 py-2.5 text-sm">{{ d.answer }}</div>
          </div>
        </li>
      </ul>
      <form v-if="!readonly && left > 0" class="mt-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="ask">
        <label class="sr-only" for="rt-question">{{ t('route.askTitle') }}</label>
        <input id="rt-question" v-model="question" class="input" maxlength="500" :placeholder="t('route.askPlaceholder')" />
        <button class="btn btn-ghost shrink-0" :disabled="question.trim().length < 5 || asking">
          <Icon name="chat" :size="17" /> {{ asking ? t('common.loading') : t('route.ask') }}
        </button>
      </form>
      <p v-if="askError" class="mt-2 text-sm font-semibold text-bad-dark">{{ askError }}</p>
    </div>

    <!-- Step 1: qualification -->
    <div class="card p-5">
      <label class="eyebrow block" for="rt-qual">{{ t('route.step1') }}</label>
      <p class="mt-2 text-sm text-ink-mute">{{ t('route.step1Hint') }}</p>
      <textarea id="rt-qual" class="input mt-3" rows="5" :readonly="readonly" :value="modelValue.qualification" @input="set({ qualification: val($event) })" />
    </div>

    <!-- Step 2: the route -->
    <div class="card p-5">
      <span class="eyebrow">{{ t('route.step2') }}</span>
      <p class="mt-2 text-sm text-ink-mute">{{ t('route.step2Hint') }}</p>
      <ol class="mt-4 flex flex-col gap-3">
        <li v-for="(s, i) in modelValue.steps" :key="i" class="rounded-xl border border-line p-4">
          <div class="flex items-center gap-2">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-bold text-brand-dark">{{ i + 1 }}</span>
            <span class="flex-1 text-sm font-semibold">{{ t('route.stepN', { n: i + 1 }) }}</span>
            <template v-if="!readonly">
              <button type="button" class="btn btn-icon !h-8 !w-8" :disabled="i === 0" :aria-label="t('route.up')" @click="moveStep(i, -1)"><Icon name="arrowLeft" :size="15" class="rotate-90" /></button>
              <button type="button" class="btn btn-icon !h-8 !w-8 text-bad" :aria-label="t('common.delete')" @click="removeStep(i)"><Icon name="trash" :size="15" /></button>
            </template>
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div class="md:col-span-2">
              <label class="label !text-xs" :for="`rt-body-${i}`">{{ t('route.body') }}</label>
              <div v-if="readonly" class="input bg-paper">{{ s.bodyName || s.bodyCode }}</div>
              <BodyPicker v-else :id="`rt-body-${i}`" :model-value="s.bodyCode ? { code: s.bodyCode, name: s.bodyName } : null"
                @update:model-value="v => setStep(i, { bodyCode: v?.code ?? '', bodyName: v?.name ?? '' })" />
            </div>
            <div>
              <label class="label !text-xs" :for="`rt-basis-${i}`">{{ t('route.basis') }}</label>
              <input :id="`rt-basis-${i}`" class="input" :readonly="readonly" :placeholder="t('route.basisHint')" :value="s.basis" @input="setStep(i, { basis: val($event) })" />
            </div>
            <div>
              <label class="label !text-xs" :for="`rt-deadline-${i}`">{{ t('route.deadline') }}</label>
              <input :id="`rt-deadline-${i}`" class="input" :readonly="readonly" :placeholder="t('route.deadlineHint')" :value="s.deadline" @input="setStep(i, { deadline: val($event) })" />
            </div>
          </div>
        </li>
      </ol>
      <button v-if="!readonly && modelValue.steps.length < 8" type="button" class="btn btn-ghost mt-3" @click="addStep"><Icon name="plus" :size="17" /> {{ t('route.addStep') }}</button>
    </div>

    <!-- Step 3: the application to the first body -->
    <div class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <label class="eyebrow" for="rt-doc">{{ t('route.step3') }}</label>
        <button v-if="!readonly && scaffold.length && !modelValue.document.trim()" type="button" class="btn btn-link" @click="set({ document: scaffold.map(s => `${s.title}\n\n`).join('\n') })">{{ t('task.insertScaffold') }}</button>
      </div>
      <p class="mt-2 text-sm text-ink-mute">{{ firstBody ? t('route.step3For', { body: firstBody }) : t('route.step3Hint') }}</p>
      <ol v-if="scaffold.length && !readonly" class="mt-3 flex flex-col gap-1.5 text-sm">
        <li v-for="(s, i) in scaffold" :key="i"><b>{{ i + 1 }}. {{ s.title }}</b> <span v-if="s.hint" class="text-ink-mute">- {{ s.hint }}</span></li>
      </ol>
      <textarea id="rt-doc" class="input mt-3 min-h-[320px]" :readonly="readonly" :placeholder="t('route.docPlaceholder')" :value="modelValue.document" @input="set({ document: val($event) })" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import BodyPicker from './BodyPicker.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'

export interface RouteStep { bodyCode: string; bodyName: string; basis: string; deadline: string }
export interface RouteAnswer { qualification: string; steps: RouteStep[]; document: string }

const props = withDefaults(defineProps<{
  modelValue: RouteAnswer
  instanceId: string
  dialog: { question: string; answer: string }[]
  scaffold?: { title: string; hint: string }[]
  readonly?: boolean
}>(), { scaffold: () => [], readonly: false })
const emit = defineEmits<{ 'update:modelValue': [value: RouteAnswer]; asked: [entry: { question: string; answer: string }] }>()
const { t, te } = useI18n()

const MAX_QUESTIONS = 3
const left = computed(() => Math.max(0, MAX_QUESTIONS - props.dialog.length))
const firstBody = computed(() => props.modelValue.steps[0]?.bodyName ?? '')
const val = (e: Event) => (e.target as HTMLInputElement).value
const set = (patch: Partial<RouteAnswer>) => emit('update:modelValue', { ...props.modelValue, ...patch })
const setStep = (i: number, patch: Partial<RouteStep>) => set({ steps: props.modelValue.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
const addStep = () => set({ steps: [...props.modelValue.steps, { bodyCode: '', bodyName: '', basis: '', deadline: '' }] })
const removeStep = (i: number) => set({ steps: props.modelValue.steps.filter((_, j) => j !== i) })
function moveStep(i: number, d: number) {
  const steps = [...props.modelValue.steps]
  const [s] = steps.splice(i, 1)
  steps.splice(i + d, 0, s)
  set({ steps })
}

const question = ref('')
const asking = ref(false)
const askError = ref('')
async function ask() {
  asking.value = true
  askError.value = ''
  try {
    const { data } = await apiClient.post(`/tasks/instances/${props.instanceId}/ask-client`, { question: question.value.trim() })
    emit('asked', data.reply)
    question.value = ''
  } catch (e) {
    const code = apiErrorCode(e)
    askError.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    asking.value = false
  }
}
</script>
