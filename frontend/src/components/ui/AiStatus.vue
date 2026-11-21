<template>
  <!-- AI health for the admin: key present, models, a live test call and the last errors from the AI log -->
  <section class="card p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h2 class="font-bold">{{ t('admin.aiStatus.title') }}</h2>
        <span v-if="status" class="chip" :class="status.configured ? 'chip-ok' : 'chip-bad'">
          {{ status.configured ? t('admin.aiStatus.keySet') : t('admin.aiStatus.keyMissing') }}
        </span>
      </div>
      <button class="btn btn-ghost" :disabled="pinging" @click="ping">{{ pinging ? t('common.loading') : t('admin.aiStatus.ping') }}</button>
    </div>
    <div v-if="status" class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-mute">
      <span>{{ t('admin.aiStatus.fast') }}: <code>{{ status.models.fast }}</code></span>
      <span>{{ t('admin.aiStatus.smart') }}: <code>{{ status.models.smart }}</code></span>
      <span v-if="status.models.overrides">{{ t('admin.aiStatus.overrides') }}: <code>{{ status.models.overrides }}</code></span>
      <span>{{ t('admin.aiStatus.batch') }}: {{ status.batch ? t('common.yes') : t('common.no') }}</span>
      <span v-if="status.lastOk">{{ t('admin.aiStatus.lastOk') }}: {{ fmt(status.lastOk.at) }} ({{ status.lastOk.purpose }})</span>
    </div>
    <p v-if="pingResult" class="mt-3 rounded-xl px-4 py-3 text-sm font-semibold" :class="pingResult.ok ? 'bg-ok-soft text-ok-dark' : 'bg-bad-soft text-bad-dark'">
      <template v-if="pingResult.ok">{{ t('admin.aiStatus.pingOk', { model: pingResult.model, s: (pingResult.latencyMs / 1000).toFixed(1) }) }}</template>
      <template v-else>{{ t('admin.aiStatus.pingFail') }}<span v-if="pingResult.status"> (HTTP {{ pingResult.status }})</span>: <span class="break-all font-normal">{{ pingResult.error }}</span></template>
    </p>
    <div v-if="status?.lastErrors.length" class="mt-3">
      <div class="label !text-xs">{{ t('admin.aiStatus.lastErrors') }}</div>
      <ul class="flex flex-col gap-1 text-xs">
        <li v-for="(e, i) in status.lastErrors" :key="i" class="rounded-lg bg-paper px-3 py-2">
          <span class="text-ink-mute">{{ fmt(e.at) }}</span> <code>{{ e.purpose }}</code> <span v-if="e.model" class="text-ink-mute">{{ e.model }}</span>
          <div class="mt-0.5 break-all text-bad-dark">{{ e.error }}</div>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'

const { t, locale } = useI18n()
const status = ref<any>(null)
const pinging = ref(false)
const pingResult = ref<any>(null)

const fmt = (d: string) => new Date(d).toLocaleString(locale.value === 'uz' ? 'uz-UZ' : 'ru-RU')

async function load() {
  try { status.value = (await apiClient.get('/admin/ai/status')).data } catch { status.value = null }
}
async function ping() {
  pinging.value = true
  try { pingResult.value = (await apiClient.post('/admin/ai/ping')).data } catch (e: any) { pingResult.value = { ok: false, error: String(e?.message ?? e) } }
  pinging.value = false
  load()
}
onMounted(load)
</script>
