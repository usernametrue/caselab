<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">{{ t('progress.title') }}</h1>
      <p class="mt-1 text-ink-soft">{{ t('progress.lead') }}</p>
    </div>

    <!-- PRD 10.2 weeklySummary: AI report on the last 7 days, one per week -->
    <section v-if="week.loading || week.data || week.reason === 'no_activity' || week.reason === 'queued'" class="card p-5">
      <h2 class="flex items-center gap-2 text-lg font-bold"><Icon name="sparkles" /> {{ t('progress.weekTitle') }}</h2>
      <p v-if="week.loading" class="mt-2 text-sm text-ink-mute">{{ t('progress.weekLoading') }}</p>
      <p v-else-if="week.reason === 'queued'" class="mt-2 text-sm text-ink-mute">{{ t('progress.weekQueued') }}</p>
      <p v-else-if="!week.data" class="mt-2 text-sm text-ink-mute">{{ t('progress.weekEmpty') }}</p>
      <template v-else>
        <p class="mt-1 text-xs font-semibold text-ink-mute">{{ t('progress.weekPeriod', { from: ddmmyyyy(week.data.periodFrom), to: ddmmyyyy(week.data.periodTo), n: week.data.stats?.attempts ?? 0, avg: week.data.stats?.avgScore ?? '-' }) }}</p>
        <p class="mt-3 whitespace-pre-line">{{ week.data.summary }}</p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <div v-if="week.data.strengths.length">
            <h3 class="text-sm font-bold text-ok-dark">{{ t('progress.weekStrengths') }}</h3>
            <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm"><li v-for="(x, i) in week.data.strengths" :key="i">{{ x }}</li></ul>
          </div>
          <div v-if="week.data.focus.length">
            <h3 class="text-sm font-bold text-warn-dark">{{ t('progress.weekFocus') }}</h3>
            <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm"><li v-for="(x, i) in week.data.focus" :key="i">{{ x }}</li></ul>
          </div>
        </div>
      </template>
    </section>

    <section v-if="weak.length" class="card border-warn/30 bg-warn-soft p-5">
      <h2 class="flex items-center gap-2 font-bold text-warn-dark"><Icon name="lightbulb" /> {{ t('progress.weakTitle') }}</h2>
      <ul class="mt-3 flex flex-col gap-2">
        <li v-for="s in weak" :key="s.key" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
          <span class="font-semibold">{{ s.name }}</span>
          <button class="btn btn-ghost" :disabled="busy" @click="trainSkill(s.key)">{{ t('progress.train') }}</button>
        </li>
      </ul>
    </section>

    <section class="card p-5">
      <h2 class="text-lg font-bold">{{ t('progress.skills') }}</h2>
      <p class="mt-1 text-sm text-ink-mute">{{ t('progress.skillsLead') }}</p>
      <div class="mt-4 grid gap-5 sm:grid-cols-2">
        <div v-for="topic in topics" :key="topic.key">
          <h3 class="font-bold">{{ topic.name }}</h3>
          <ul class="mt-2 flex flex-col gap-3">
            <li v-for="s in topic.children" :key="s.key" class="text-sm">
              <div class="flex items-center justify-between gap-2">
                <span :class="s.rating == null ? 'text-ink-mute' : ''">{{ s.name }}</span>
                <span v-if="s.rating != null" class="text-xs font-semibold text-ink-mute">{{ t('progress.attempts', { n: s.attemptsCount }) }} · {{ s.avgScore }}</span>
                <span v-else class="text-xs text-ink-mute">{{ t('progress.notTrained') }}</span>
              </div>
              <ProgressBar class="mt-1" :value="ratingPercent(s.rating)" :height="6" :color="s.problematic ? 'var(--warn)' : 'var(--brand)'" :label="s.name" />
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- STD-6: achievements -->
    <section id="achievements" class="card p-5">
      <h2 class="text-lg font-bold">{{ t('progress.achievements') }}</h2>
      <ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="a in achievements" :key="a.code" class="flex items-start gap-3 rounded-xl border p-4" :class="a.earnedAt ? 'border-sun/60 bg-sun-soft' : 'border-line'">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl" :class="a.earnedAt ? 'bg-sun text-ink' : 'bg-paper text-ink-mute'"><Icon name="trophy" :size="20" /></span>
          <div class="min-w-0">
            <div class="font-bold" :class="a.earnedAt ? '' : 'text-ink-soft'">{{ t(`achievements.${a.code}`) }}</div>
            <div class="text-sm text-ink-soft">{{ t(`achievementRules.${a.code}`) }}</div>
            <div v-if="a.earnedAt" class="mt-1 text-xs font-semibold text-warn-dark">{{ new Date(a.earnedAt).toLocaleDateString(locale === 'uz' ? 'uz-UZ' : 'ru-RU') }}</div>
          </div>
        </li>
      </ul>
    </section>

    <section class="card p-5">
      <h2 class="text-lg font-bold">{{ t('progress.history') }}</h2>
      <p v-if="!history.length" class="mt-3 text-sm text-ink-mute">{{ t('dashboard.noRecent') }}</p>
      <ul v-else class="mt-3 divide-y divide-line">
        <li v-for="a in history" :key="a.id">
          <RouterLink :to="`/app/task/${a.instanceId}`" class="flex flex-wrap items-center gap-3 py-3">
            <span class="min-w-0 flex-1 truncate font-semibold">{{ a.title }}</span>
            <span class="text-xs text-ink-mute">{{ new Date(a.createdAt).toLocaleDateString(locale === 'uz' ? 'uz-UZ' : 'ru-RU') }}</span>
            <span class="text-xs text-ink-mute">{{ t('task.iterationShort', { n: a.iteration }) }}</span>
            <span v-if="a.xpAwarded" class="chip chip-brand">+{{ a.xpAwarded }} XP</span>
            <StatusChip :status="a.status" :score="a.finalScore" />
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import StatusChip from '@/components/ui/StatusChip.vue'
import { apiClient, LLM_TIMEOUT } from '@/plugins/axios'
import { startTask } from '@/utils/tasks'
import { toast } from '@/components/ui/toast'

const { t, te, locale } = useI18n()
const router = useRouter()
const skills = ref<any[]>([])
const history = ref<any[]>([])
const busy = ref(false)
const achievements = ref<{ code: string; earnedAt: string | null }[]>([])

onMounted(async () => {
  const [s, h, a] = await Promise.all([apiClient.get('/me/skills'), apiClient.get('/attempts', { params: { limit: 30 } }), apiClient.get('/me/achievements')])
  skills.value = s.data.skills
  history.value = h.data.attempts
  achievements.value = a.data.achievements
})

// Loaded on its own: the first visit of the week waits for the LLM
const week = reactive<{ loading: boolean; data: any; reason: string | null }>({ loading: true, data: null, reason: null })
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('.')
onMounted(async () => {
  try {
    const { data } = await apiClient.get('/me/weekly-summary', { timeout: LLM_TIMEOUT })
    week.data = data.summary
    week.reason = data.reason
  } catch {
    week.reason = 'failed'
  } finally {
    week.loading = false
  }
})

const topics = computed(() => skills.value.filter(s => !s.parentKey).map(topic => ({
  ...topic,
  children: skills.value.filter(s => s.parentKey === topic.key)
})).filter(topic => topic.children.length))
const weak = computed(() => skills.value.filter(s => s.problematic))
// Skill rating 800-1600 shown as 0-100% (task difficulty 1-5 spans the same range)
const ratingPercent = (r: number | null) => (r == null ? 0 : Math.max(2, Math.min(100, ((r - 800) / 800) * 100)))

async function trainSkill(skillKey: string) {
  busy.value = true
  const code = await startTask(router, { skillKey })
  if (code) toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  busy.value = false
}
</script>
