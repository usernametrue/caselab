<template>
  <div v-if="group" class="flex flex-col gap-5">
    <div>
      <RouterLink to="/teacher" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('teacher.nav.groups') }}</RouterLink>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ group.name }}</h1>
    </div>
    <div class="card flex flex-wrap items-center gap-4 p-5">
      <div class="flex-1">
        <div class="text-sm font-semibold">{{ t('teacher.groups.inviteTitle') }}</div>
        <p class="text-sm text-ink-soft">{{ t('teacher.groups.inviteHint') }}</p>
      </div>
      <code class="rounded-xl bg-brand-soft px-4 py-2 font-mono text-xl font-extrabold tracking-widest text-brand-dark">{{ group.inviteCode }}</code>
      <button class="btn btn-ghost" @click="copy">{{ t('teacher.groups.copy') }}</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-ink-mute">
          <tr><th class="p-3">{{ t('auth.fullName') }}</th><th class="p-3">{{ t('auth.course') }}</th><th class="p-3">{{ t('teacher.groups.level') }}</th><th class="p-3">{{ t('teacher.groups.attempts') }}</th><th class="p-3">{{ t('teacher.groups.avg') }}</th><th class="p-3"></th></tr>
        </thead>
        <tbody>
          <tr v-if="!students.length"><td colspan="6" class="p-6 text-center text-ink-mute">{{ t('teacher.groups.noStudents') }}</td></tr>
          <tr v-for="s in students" :key="s.id" class="border-b border-line last:border-0">
            <td class="p-3"><div class="font-semibold">{{ s.fullName }}</div><div class="text-xs text-ink-mute">{{ s.email }}</div></td>
            <td class="p-3">{{ s.course ?? '-' }}</td>
            <td class="p-3">{{ s.level }} · {{ s.xp }} XP</td>
            <td class="p-3">{{ s.attempts }}</td>
            <td class="p-3"><span v-if="s.avgScore != null" class="chip" :class="s.avgScore < 56 ? 'chip-warn' : 'chip-ok'">{{ s.avgScore }}</span><span v-else>-</span></td>
            <td class="p-3 text-right"><button class="btn btn-link text-bad" @click="removeStudent(s)">{{ t('teacher.groups.remove') }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- TCH-4: skills heatmap, typical errors, students at risk -->
    <template v-if="analytics">
      <section v-if="analytics.atRisk.length" class="card border-warn/30 bg-warn-soft p-5">
        <h2 class="flex items-center gap-2 font-bold text-warn-dark"><Icon name="info" /> {{ t('teacher.analytics.atRisk') }}</h2>
        <ul class="mt-3 flex flex-col gap-2">
          <li v-for="r in analytics.atRisk" :key="r.id" class="rounded-xl bg-white p-3 text-sm">
            <b>{{ r.fullName }}</b>
            <span class="ml-2 text-ink-soft">{{ r.reasons.map((x: string) => t(`teacher.analytics.reasons.${x}`)).join(', ') }}</span>
            <span v-if="r.problemSkills.length" class="block text-xs text-ink-mute">{{ r.problemSkills.join(', ') }}</span>
          </li>
        </ul>
      </section>

      <section class="card p-5">
        <h2 class="text-lg font-bold">{{ t('teacher.analytics.heatmap') }}</h2>
        <p class="mt-1 text-sm text-ink-mute">{{ t('teacher.analytics.heatmapHint') }}</p>
        <p v-if="!analytics.skills.length" class="mt-3 text-sm text-ink-mute">{{ t('teacher.analytics.noData') }}</p>
        <div v-else class="mt-4 overflow-x-auto">
          <table class="border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th class="sticky left-0 bg-white p-2 text-left font-semibold text-ink-mute">{{ t('auth.fullName') }}</th>
                <th v-for="sk in analytics.skills" :key="sk.key" class="min-w-[84px] max-w-[120px] p-2 text-left align-bottom font-semibold text-ink-soft" :title="sk.key">{{ sk.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="sticky left-0 bg-white p-2 font-bold">{{ t('teacher.analytics.groupAvg') }}</td>
                <td v-for="sk in analytics.skills" :key="sk.key" class="rounded-lg p-2 text-center font-bold" :class="heat(sk.avgScore)">{{ sk.avgScore ?? '-' }}</td>
              </tr>
              <tr v-for="row in analytics.heatmap" :key="row.id">
                <td class="sticky left-0 bg-white p-2 font-semibold">{{ row.fullName }}</td>
                <td v-for="(c, i) in row.cells" :key="i" class="rounded-lg p-2 text-center" :class="c ? heat(c.avgScore) : 'bg-paper text-ink-mute'" :title="c ? t('progress.attempts', { n: c.attempts }) : ''">
                  {{ c ? c.avgScore : '·' }}<span v-if="c?.problematic" class="ml-0.5">!</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="analytics.typicalErrors.length" class="card p-5">
        <h2 class="text-lg font-bold">{{ t('teacher.analytics.errors') }}</h2>
        <ul class="mt-3 flex flex-col gap-2">
          <li v-for="e in analytics.typicalErrors" :key="e.errorType" class="flex items-center gap-3 text-sm">
            <span class="min-w-0 flex-1">{{ te(`errorTypes.${e.errorType}`) ? t(`errorTypes.${e.errorType}`) : e.errorType }}</span>
            <span class="chip chip-outline">{{ e.count }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const props = defineProps<{ id: string }>()
const { t, te } = useI18n()
const group = ref<any>(null)
const students = ref<any[]>([])
const analytics = ref<any>(null)
async function load() {
  const [{ data }, a] = await Promise.all([apiClient.get(`/teacher/groups/${props.id}`), apiClient.get(`/teacher/groups/${props.id}/analytics`).catch(() => null)])
  group.value = data.group
  students.value = data.students
  analytics.value = a?.data ?? null
}
// Score bands of PRD 5.3: 86+ excellent, 71+ good, 56+ satisfactory
const heat = (score: number | null) => (score == null ? 'bg-paper text-ink-mute' : score >= 86 ? 'bg-ok-soft text-ok-dark' : score >= 71 ? 'bg-brand-soft text-brand-dark' : score >= 56 ? 'bg-warn-soft text-warn-dark' : 'bg-bad-soft text-bad-dark')
async function copy() {
  try { await navigator.clipboard.writeText(group.value.inviteCode); toast(t('teacher.groups.copied'), 'ok') } catch { /* clipboard unavailable */ }
}
async function removeStudent(s: any) {
  if (!window.confirm(t('teacher.groups.confirmRemove', { name: s.fullName }))) return
  await apiClient.delete(`/teacher/groups/${props.id}/students/${s.id}`)
  load()
}
onMounted(load)
</script>
