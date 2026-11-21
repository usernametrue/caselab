<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.results.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.results.lead') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="s in filters" :key="s" class="filter" :class="{ 'is-active': status === s }" @click="status = s; load()">{{ s ? t(`status.${s}`) : t('common.all') }}</button>
      </div>
    </div>
    <!-- ADM-8: filters for the table and the CSV export -->
    <div class="card flex flex-wrap items-end gap-3 p-4">
      <div><label class="label !text-xs" for="r-mode">{{ t('admin.results.mode') }}</label>
        <select id="r-mode" v-model="mode" class="input !w-auto" @change="load"><option value="">{{ t('common.all') }}</option><option v-for="m in modes" :key="m" :value="m">{{ t(`modes.${m}.title`) }}</option></select></div>
      <div><label class="label !text-xs" for="r-from">{{ t('admin.results.from') }}</label><input id="r-from" v-model="from" type="date" class="input" @change="load" /></div>
      <div><label class="label !text-xs" for="r-to">{{ t('admin.results.to') }}</label><input id="r-to" v-model="to" type="date" class="input" @change="load" /></div>
      <button class="btn btn-ghost ml-auto" :disabled="exporting" @click="exportCsv"><Icon name="file" :size="17" /> {{ exporting ? t('common.loading') : t('admin.results.csv') }}</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-ink-mute">
          <tr><th class="p-3">{{ t('admin.results.student') }}</th><th class="p-3">{{ t('admin.results.task') }}</th><th class="p-3">{{ t('admin.results.iteration') }}</th><th class="p-3">{{ t('admin.results.score') }}</th><th class="p-3">{{ t('admin.results.status') }}</th><th class="p-3">{{ t('admin.results.date') }}</th><th class="p-3"></th></tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length"><td colspan="7" class="p-6 text-center text-ink-mute">{{ t('admin.results.empty') }}</td></tr>
          <tr v-for="r in rows" :key="r.id" class="border-b border-line last:border-0">
            <td class="p-3"><div class="font-semibold">{{ r.user?.fullName }}</div><div class="text-xs text-ink-mute">{{ r.user?.email }}</div></td>
            <td class="p-3">{{ r.title }}<div class="text-xs text-ink-mute">{{ r.mode }} · {{ t('train.difficulty', { n: r.difficulty }) }}</div></td>
            <td class="p-3">{{ r.iteration }}</td>
            <td class="p-3 font-bold">{{ r.finalScore ?? '-' }}</td>
            <td class="p-3">
              <StatusChip :status="r.status" :score="null" />
              <div v-if="r.reviewReasons?.length" class="mt-1 text-xs text-warn-dark">{{ r.reviewReasons.map((x: string) => t(`admin.results.reasons.${x}`)).join(', ') }}</div>
              <div v-if="r.lastError && r.status !== 'auto'" class="mt-1 max-w-xs truncate text-xs text-ink-mute" :title="r.lastError">{{ r.lastError }}</div>
            </td>
            <td class="p-3 text-xs text-ink-mute">{{ new Date(r.createdAt).toLocaleString('ru-RU') }}</td>
            <td class="p-3"><button v-if="r.status === 'failed'" class="btn btn-ghost" @click="requeue(r.id)"><Icon name="refresh" :size="16" /> {{ t('admin.results.requeue') }}</button></td>
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
import StatusChip from '@/components/ui/StatusChip.vue'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t } = useI18n()
const rows = ref<any[]>([])
const status = ref('')
const filters = ['', 'evaluating', 'auto', 'needs_review', 'failed']
const modes = ['draft', 'review', 'process', 'route', 'sim']
const mode = ref('')
const from = ref('')
const to = ref('')
const params = () => Object.fromEntries(Object.entries({ status: status.value, mode: mode.value, from: from.value, to: to.value }).filter(([, v]) => v))

async function load() {
  const { data } = await apiClient.get('/admin/results', { params: params() })
  rows.value = data.results
}

// The file comes through the API client so that the access token is sent
const exporting = ref(false)
async function exportCsv() {
  exporting.value = true
  try {
    const res = await apiClient.get('/admin/results.csv', { params: params(), responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `results-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast(t('errors.generic'), 'bad')
  } finally {
    exporting.value = false
  }
}
async function requeue(id: string) {
  await apiClient.post(`/admin/results/${id}/requeue`)
  toast(t('admin.results.requeued'), 'ok')
  load()
}
onMounted(load)
</script>
