<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.audit.title') }}</h1>
      <p class="mt-1 text-sm text-ink-soft">{{ t('admin.audit.lead') }}</p>
    </div>
    <AiStatus />
    <!-- AI cost per task for 7 days: calls, cached share of the input, batch share -->
    <section v-if="usage" class="card overflow-x-auto p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-bold">{{ t('admin.aiUsage.title', { n: usage.days }) }}</h2>
        <span class="text-sm font-semibold">{{ t('admin.aiUsage.total', { usd: usage.totalUsd.toFixed(2) }) }}</span>
      </div>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.aiUsage.lead') }}</p>
      <p v-if="!usage.items.length" class="mt-3 text-sm text-ink-mute">{{ t('admin.aiUsage.empty') }}</p>
      <table v-else class="mt-3 w-full min-w-[640px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-ink-mute">
          <tr><th class="py-2 pr-3">{{ t('admin.aiUsage.purpose') }}</th><th class="py-2 pr-3">{{ t('admin.aiUsage.calls') }}</th><th class="py-2 pr-3">{{ t('admin.aiUsage.batch') }}</th><th class="py-2 pr-3">{{ t('admin.aiUsage.cache') }}</th><th class="py-2 pr-3">{{ t('admin.aiUsage.latency') }}</th><th class="py-2">{{ t('admin.aiUsage.cost') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in usage.items" :key="u.purpose" class="border-b border-line">
            <td class="py-2 pr-3"><code class="text-xs">{{ u.purpose }}</code><span v-if="u.errors" class="chip chip-bad ml-2">{{ u.errors }}</span></td>
            <td class="py-2 pr-3">{{ u.calls }}</td>
            <td class="py-2 pr-3">{{ u.batch }}</td>
            <td class="py-2 pr-3">{{ u.cacheShare }}%</td>
            <td class="py-2 pr-3">{{ u.avgLatencyMs == null ? '-' : `${(u.avgLatencyMs / 1000).toFixed(1)} s` }}</td>
            <td class="py-2">${{ u.costUsd.toFixed(4) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <!-- ADM-9: filters -->
    <div class="card flex flex-wrap items-end gap-3 p-4">
      <div><label class="label !text-xs" for="a-actor">{{ t('admin.audit.actor') }}</label>
        <select id="a-actor" v-model="actorId" class="input !w-auto" @change="reload"><option value="">{{ t('common.all') }}</option><option v-for="a in admins" :key="a.id" :value="a.id">{{ a.fullName }}</option></select></div>
      <div><label class="label !text-xs" for="a-q">{{ t('admin.audit.search') }}</label>
        <input id="a-q" v-model="q" class="input" :placeholder="t('admin.audit.searchHint')" @keyup.enter="reload" @change="reload" /></div>
      <div><label class="label !text-xs" for="a-from">{{ t('admin.results.from') }}</label><input id="a-from" v-model="from" type="date" class="input" @change="reload" /></div>
      <div><label class="label !text-xs" for="a-to">{{ t('admin.results.to') }}</label><input id="a-to" v-model="to" type="date" class="input" @change="reload" /></div>
      <label class="flex items-center gap-2 pb-2 text-sm"><input v-model="failed" type="checkbox" @change="reload" /> {{ t('admin.audit.failedOnly') }}</label>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-ink-mute">
          <tr><th class="p-3">{{ t('admin.audit.date') }}</th><th class="p-3">{{ t('admin.audit.actor') }}</th><th class="p-3">{{ t('admin.audit.action') }}</th><th class="p-3">{{ t('admin.audit.result') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="!items.length"><td colspan="4" class="p-6 text-center text-ink-mute">{{ t('admin.audit.empty') }}</td></tr>
          <template v-for="i in items" :key="i.id">
            <tr class="cursor-pointer border-b border-line hover:bg-brand-tint" @click="open = open === i.id ? '' : i.id">
              <td class="whitespace-nowrap p-3 text-xs text-ink-mute">{{ new Date(i.createdAt).toLocaleString(locale === 'uz' ? 'uz-UZ' : 'ru-RU') }}</td>
              <td class="p-3"><div class="font-semibold">{{ i.actor?.fullName ?? '-' }}</div><div class="text-xs text-ink-mute">{{ i.actor?.email }}</div></td>
              <td class="p-3"><code class="break-all text-xs">{{ i.method }} {{ i.path }}</code></td>
              <td class="p-3"><span class="chip" :class="i.status < 400 ? 'chip-ok' : 'chip-bad'">{{ i.status }}</span></td>
            </tr>
            <tr v-if="open === i.id" class="border-b border-line bg-paper">
              <td colspan="4" class="p-3">
                <div class="label !text-xs">{{ t('admin.audit.body') }}</div>
                <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs">{{ pretty(i.body) }}</pre>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between gap-3 text-sm">
      <span class="text-ink-mute">{{ t('admin.audit.total', { n: total }) }}</span>
      <div class="flex gap-2">
        <button class="btn btn-ghost" :disabled="page === 0" @click="page--; load()">{{ t('admin.audit.prev') }}</button>
        <button class="btn btn-ghost" :disabled="(page + 1) * LIMIT >= total" @click="page++; load()">{{ t('admin.audit.next') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'
import AiStatus from '@/components/ui/AiStatus.vue'

const { t, locale } = useI18n()
const LIMIT = 50
const items = ref<any[]>([])
const admins = ref<any[]>([])
const total = ref(0)
const page = ref(0)
const actorId = ref('')
const q = ref('')
const from = ref('')
const to = ref('')
const failed = ref(false)
const open = ref('')
const usage = ref<any>(null)

async function load() {
  const params: Record<string, string | number> = { page: page.value, limit: LIMIT }
  if (actorId.value) params.actorId = actorId.value
  if (q.value.trim()) params.q = q.value.trim()
  if (from.value) params.from = from.value
  if (to.value) params.to = to.value
  if (failed.value) params.failed = '1'
  const { data } = await apiClient.get('/admin/audit', { params })
  items.value = data.items
  admins.value = data.admins
  total.value = data.total
}
function reload() {
  page.value = 0
  load()
}
const pretty = (body: string) => {
  if (!body) return '-'
  try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body }
}
onMounted(load)
onMounted(async () => {
  try { usage.value = (await apiClient.get('/admin/ai/usage')).data } catch { usage.value = null }
})
</script>
