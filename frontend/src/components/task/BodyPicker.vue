<template>
  <div class="relative">
    <input :id="id" class="input" :value="query" :readonly="readonly" :placeholder="placeholder || t('route.bodyHint')" autocomplete="off"
      role="combobox" :aria-expanded="open" :aria-controls="`${id}-list`"
      @input="onInput(($event.target as HTMLInputElement).value)" @focus="onFocus" @blur="close" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="choose(results[active])" />
    <ul v-if="open && results.length" :id="`${id}-list`" role="listbox" class="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-white p-1 shadow-card">
      <li v-for="(b, i) in results" :key="b.code" role="option" :aria-selected="i === active">
        <button type="button" class="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm" :class="i === active ? 'bg-brand-tint' : 'hover:bg-paper'" @mousedown.prevent="choose(b)">
          <span class="font-semibold">{{ b.name }}</span>
          <span class="text-xs text-ink-mute">{{ t(`route.kinds.${b.kind}`) }}<template v-if="b.region"> · {{ b.region }}</template></span>
        </button>
      </li>
    </ul>
    <p v-if="open && !results.length && query.length >= 2 && !busy" class="absolute z-20 mt-1 w-full rounded-xl border border-line bg-white p-3 text-sm text-ink-mute shadow-card">{{ t('route.noBodies') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'

export interface BodyRef { code: string; name: string }

const props = withDefaults(defineProps<{ modelValue: BodyRef | null; id: string; readonly?: boolean; placeholder?: string }>(), { readonly: false, placeholder: '' })
const emit = defineEmits<{ 'update:modelValue': [value: BodyRef | null] }>()
const { t, locale } = useI18n()

const query = ref(props.modelValue?.name ?? '')
const results = ref<{ code: string; name: string; kind: string; region: string }[]>([])
const open = ref(false)
const busy = ref(false)
const active = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null

watch(() => props.modelValue, v => { if (v && v.name !== query.value) query.value = v.name })

async function search(q: string) {
  busy.value = true
  try {
    const { data } = await apiClient.get('/bodies', { params: { q, locale: locale.value } })
    results.value = data.bodies
    active.value = 0
  } catch {
    results.value = []
  } finally {
    busy.value = false
  }
}
function onInput(v: string) {
  query.value = v
  open.value = true
  // Typing a new name drops the chosen body: only dictionary bodies are accepted
  if (props.modelValue) emit('update:modelValue', null)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => search(v), 250)
}
function onFocus() {
  if (props.readonly) return
  open.value = true
  if (!results.value.length) search(query.value)
}
function close() { setTimeout(() => { open.value = false }, 120) }
function move(d: number) {
  if (!results.value.length) return
  active.value = (active.value + d + results.value.length) % results.value.length
}
function choose(b?: { code: string; name: string }) {
  if (!b) return
  query.value = b.name
  emit('update:modelValue', { code: b.code, name: b.name })
  open.value = false
}
</script>
