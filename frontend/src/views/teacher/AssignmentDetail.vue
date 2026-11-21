<template>
  <div v-if="data" class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <RouterLink to="/teacher/assignments" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('teacher.nav.assignments') }}</RouterLink>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ data.assignment.title }}</h1>
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="chip" :class="data.assignment.kind === 'exam' ? 'chip-warn' : 'chip-outline'">{{ t(`dashboard.kind.${data.assignment.kind}`) }}</span>
          <span class="chip chip-outline">{{ data.assignment.groupName }}</span>
        </div>
      </div>
      <button v-if="data.assignment.kind === 'exam' && !data.assignment.resultsPublished" class="btn btn-primary" @click="publish">{{ t('teacher.assign.publish') }}</button>
      <span v-else-if="data.assignment.kind === 'exam'" class="chip chip-ok chip-lg">{{ t('teacher.assign.published') }}</span>
    </div>
    <p v-if="data.assignment.kind === 'exam' && !data.assignment.resultsPublished" class="text-sm text-ink-soft">{{ t('teacher.assign.publishHint') }}</p>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="border-b border-line text-xs text-ink-mute">
          <tr><th class="p-3 uppercase tracking-wide">{{ t('admin.results.student') }}</th><th v-for="tr in data.tracks ?? []" :key="tr.id" class="p-3 font-semibold"><Icon name="briefcase" :size="13" class="mr-1 inline text-brand" />{{ tr.title }}</th><th v-for="tpl in data.templates" :key="tpl.id" class="p-3 font-semibold">{{ tpl.title }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="!data.rows.length"><td :colspan="data.templates.length + (data.tracks ?? []).length + 1" class="p-6 text-center text-ink-mute">{{ t('teacher.groups.noStudents') }}</td></tr>
          <tr v-for="row in data.rows" :key="row.student.id" class="border-b border-line last:border-0">
            <td class="p-3"><div class="font-semibold">{{ row.student.fullName }}</div><div class="text-xs text-ink-mute">{{ row.student.email }}</div></td>
            <td v-for="c in row.trackCells ?? []" :key="c.trackId" class="p-3">
              <span v-if="c.status === 'finished'" class="chip" :class="(c.finalScore ?? 0) < 56 ? 'chip-warn' : 'chip-ok'">{{ c.finalScore }} · {{ t(`caseRun.outcomes.${c.outcome}`) }}</span>
              <span v-else-if="c.status === 'active'" class="chip chip-muted">{{ t('teacher.assign.caseProgress', { n: c.stagesDone }) }}</span>
              <span v-else class="text-ink-mute">-</span>
            </td>
            <td v-for="c in row.cells" :key="c.templateId" class="p-3">
              <span v-if="c.bestScore != null" class="chip" :class="c.bestScore < 56 ? 'chip-warn' : 'chip-ok'">{{ c.bestScore }}</span>
              <span v-else-if="c.started" class="chip chip-muted">{{ t('teacher.assign.inProgress') }}</span>
              <span v-else class="text-ink-mute">-</span>
              <span v-if="c.pending" class="ml-1 chip chip-warn">{{ t('status.needs_review') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const data = ref<any>(null)
async function load() { data.value = (await apiClient.get(`/teacher/assignments/${props.id}`)).data }
async function publish() {
  if (!window.confirm(t('teacher.assign.confirmPublish'))) return
  await apiClient.post(`/teacher/assignments/${props.id}/publish-results`)
  toast(t('teacher.assign.published'), 'ok')
  load()
}
onMounted(load)
</script>
