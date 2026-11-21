<template>
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div class="card min-w-0 p-5">
      <span class="eyebrow">{{ title || t('review.document') }}</span>
      <p class="mt-2 text-sm text-ink-mute">{{ t('fix.hint') }}</p>
      <div class="doc-text mt-4 rounded-xl border border-line bg-white p-4 leading-8">
        <template v-for="seg in segments" :key="seg.start">
          <span v-if="seg.edit == null">{{ text.slice(seg.start, seg.end) }}</span>
          <span v-else class="cursor-pointer rounded-md" :class="active === seg.edit ? 'ring-2 ring-brand/40' : ''" @click="active = seg.edit">
            <del class="bg-bad-soft text-bad-dark">{{ text.slice(seg.start, seg.end) }}</del><ins class="bg-ok-soft text-ok-dark no-underline">{{ edits[seg.edit].replacement }}</ins><sup class="px-0.5 font-bold text-brand">{{ seg.edit + 1 }}</sup>
          </span>
        </template>
      </div>
    </div>
    <div class="flex min-w-0 flex-col gap-3">
      <div v-for="(e, i) in edits" :key="e.id" class="card p-4" :class="active === i ? 'border-brand' : ''" @click="active = i">
        <div class="flex items-center gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand-dark">{{ i + 1 }}</span>
          <span class="text-sm font-semibold">{{ t('fix.edit', { n: i + 1 }) }}</span>
          <span v-if="resultFor(e.id)" class="chip ml-auto" :class="resultFor(e.id)!.ok ? 'chip-ok' : 'bg-bad-soft text-bad-dark'">{{ resultFor(e.id)!.ok ? t('result.checkOk') : t('result.checkBad') }}</span>
        </div>
        <p class="mt-2 text-sm"><span class="text-ink-mute">{{ t('fix.was') }}:</span> <del class="text-bad-dark">{{ e.quote }}</del></p>
        <p class="text-sm"><span class="text-ink-mute">{{ t('fix.now') }}:</span> <span class="text-ok-dark">{{ e.replacement || t('fix.deleted') }}</span></p>
        <div class="mt-3 inline-flex rounded-lg border border-line p-0.5" role="group">
          <button v-for="d in ['accept', 'reject'] as const" :key="d" type="button" :disabled="readonly"
            class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
            :class="decision(e.id).decision === d ? (d === 'accept' ? 'bg-ok-soft text-ok-dark' : 'bg-bad-soft text-bad-dark') : 'text-ink-soft hover:text-ink'"
            :aria-pressed="decision(e.id).decision === d" @click.stop="set(e.id, 'decision', d)">
            {{ t(`fix.${d}`) }}
          </button>
        </div>
        <template v-if="readonly">
          <p class="mt-2 text-sm"><b>{{ t('fix.reason') }}:</b> {{ decision(e.id).reason || '-' }}</p>
          <p v-if="decision(e.id).counter" class="mt-1 text-sm"><b>{{ t('fix.counter') }}:</b> {{ decision(e.id).counter }}</p>
          <p v-if="resultFor(e.id)?.explanation" class="mt-2 rounded-lg bg-paper p-2 text-xs text-ink-soft">{{ resultFor(e.id)?.explanation }}</p>
        </template>
        <template v-else>
          <label class="label mt-3 !text-xs" :for="`fr-${i}`">{{ t('fix.reason') }}</label>
          <textarea :id="`fr-${i}`" class="input !py-2 text-sm" rows="2" :placeholder="t('fix.reasonHint')" :value="decision(e.id).reason"
            @input="set(e.id, 'reason', ($event.target as HTMLTextAreaElement).value)" />
          <template v-if="decision(e.id).decision === 'reject'">
            <label class="label mt-2 !text-xs" :for="`fc-${i}`">{{ t('fix.counter') }}</label>
            <textarea :id="`fc-${i}`" class="input !py-2 text-sm" rows="2" :placeholder="t('fix.counterHint')" :value="decision(e.id).counter"
              @input="set(e.id, 'counter', ($event.target as HTMLTextAreaElement).value)" />
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface Decision { editId: string; decision: 'accept' | 'reject' | null; reason: string; counter: string }
interface Edit { id: string; from: number; to: number; quote: string; replacement: string }

const props = withDefaults(defineProps<{ text: string; edits: Edit[]; modelValue: Decision[]; title?: string; readonly?: boolean; results?: any[] | null }>(),
  { title: '', readonly: false, results: null })
const emit = defineEmits<{ 'update:modelValue': [value: Decision[]] }>()
const { t } = useI18n()
const active = ref<number | null>(null)

const segments = computed(() => {
  const order = props.edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.from - b.from)
  const out: { start: number; end: number; edit: number | null }[] = []
  let pos = 0
  for (const e of order) {
    if (e.from > pos) out.push({ start: pos, end: e.from, edit: null })
    out.push({ start: e.from, end: e.to, edit: e.i })
    pos = e.to
  }
  if (pos < props.text.length) out.push({ start: pos, end: props.text.length, edit: null })
  return out
})
const decision = (id: string) => props.modelValue.find(d => d.editId === id) ?? { editId: id, decision: null, reason: '', counter: '' }
const resultFor = (id: string) => props.results?.find(r => r.editId === id)
function set(id: string, key: keyof Decision, value: string) {
  const next = props.edits.map(e => {
    const d = decision(e.id)
    return e.id === id ? { ...d, [key]: value } : d
  })
  emit('update:modelValue', next as Decision[])
}
</script>
