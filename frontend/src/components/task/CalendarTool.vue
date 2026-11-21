<template>
  <div class="card p-5">
    <div class="flex items-center justify-between">
      <span class="eyebrow">{{ t('process.calendar') }}</span>
      <div class="flex gap-1">
        <button class="btn-icon btn !h-8 !w-8" :aria-label="t('process.prevMonth')" @click="shift(-1)"><Icon name="arrowLeft" :size="16" /></button>
        <button class="btn-icon btn !h-8 !w-8" :aria-label="t('process.nextMonth')" @click="shift(1)"><Icon name="arrowRight" :size="16" /></button>
      </div>
    </div>
    <div class="mt-2 text-sm font-bold capitalize">{{ monthLabel }}</div>
    <div class="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
      <span v-for="d in weekdays" :key="d" class="font-semibold text-ink-mute">{{ d }}</span>
      <span v-for="n in offset" :key="`e${n}`" />
      <span v-for="day in days" :key="day.iso" :title="day.title"
        class="rounded-md py-1.5 font-semibold"
        :class="[day.off ? 'bg-bad-soft text-bad-dark' : 'text-ink', day.iso === today ? 'ring-2 ring-brand' : '']">{{ day.n }}</span>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-xs text-ink-mute">
      <span class="flex items-center gap-1"><i class="h-3 w-3 rounded bg-bad-soft" /> {{ t('process.nonWorking') }}</span>
      <span class="flex items-center gap-1"><i class="h-3 w-3 rounded ring-2 ring-brand" /> {{ t('task.today') }}</span>
    </div>
    <p class="mt-2 text-xs text-ink-mute">{{ t('process.calendarNote') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'

// Month view with weekends and holidays from the calendar dictionary (the lawyer's tool from PRD 4.0)
const props = defineProps<{ today: string }>()
const { t, locale } = useI18n()
const special = ref<Record<string, { type: string; name: any }>>({})
const cursor = ref(new Date(`${props.today}T00:00:00Z`))

onMounted(async () => {
  const { data } = await apiClient.get('/calendar', { params: { year: props.today.slice(0, 4) } })
  special.value = Object.fromEntries(data.days.map((d: any) => [d.date, d]))
})

const iso = (d: Date) => d.toISOString().slice(0, 10)
const weekdays = computed(() => (locale.value === 'uz' ? ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'] : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']))
const monthLabel = computed(() => cursor.value.toLocaleDateString(locale.value === 'uz' ? 'uz-UZ' : 'ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }))
const offset = computed(() => (new Date(Date.UTC(cursor.value.getUTCFullYear(), cursor.value.getUTCMonth(), 1)).getUTCDay() + 6) % 7)
const days = computed(() => {
  const y = cursor.value.getUTCFullYear()
  const m = cursor.value.getUTCMonth()
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m, i + 1))
    const key = iso(d)
    const s = special.value[key]
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
    const off = s ? s.type !== 'working' : weekend
    return { n: i + 1, iso: key, off, title: s?.name ? (s.name[locale.value] || s.name.ru) : '' }
  })
})
const today = computed(() => props.today)
function shift(n: number) {
  const d = new Date(cursor.value)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  cursor.value = d
}
</script>
