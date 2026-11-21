<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.dict.title') }}</h1>
      <p class="mt-1 text-sm text-ink-soft">{{ t('admin.dict.lead') }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button v-for="d in dictionaries" :key="d" class="filter" :class="{ 'is-active': current === d }" @click="open(d)">{{ t(`admin.dict.names.${d}`) }}</button>
    </div>

    <template v-if="current">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-bold">{{ t(`admin.dict.names.${current}`) }} <span class="text-ink-mute">· {{ items.length }}</span></h2>
        <div class="flex flex-wrap gap-2">
          <button v-if="current === 'bodies'" class="btn btn-ghost" :disabled="importing" @click="importRegister"><Icon name="refresh" :size="18" /> {{ importing ? t('common.loading') : t('admin.dict.importRegister') }}</button>
          <button class="btn btn-primary" @click="edit(null)"><Icon name="plus" :size="18" /> {{ t('common.add') }}</button>
        </div>
      </div>
      <p v-if="current === 'bodies'" class="-mt-2 text-sm text-ink-soft">{{ t('admin.dict.bodiesSource') }} <a href="https://reestr.gov.uz/" target="_blank" rel="noopener" class="font-semibold text-brand">reestr.gov.uz</a></p>

      <form v-if="editing" class="card p-5" @submit.prevent="saveItem">
        <label class="label" for="json">{{ editing.id ? t('admin.dict.editRecord') : t('admin.dict.newRecord') }} (JSON)</label>
        <textarea id="json" v-model="editing.json" class="input min-h-[260px] font-mono text-sm" spellcheck="false" />
        <p class="mt-1.5 text-xs text-ink-mute">{{ t('admin.dict.example') }}: <code>{{ examples[current] }}</code></p>
        <p v-if="editError" class="mt-3 rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ editError }}</p>
        <div class="mt-4 flex gap-3"><button class="btn btn-primary">{{ t('common.save') }}</button><button type="button" class="btn btn-ghost" @click="editing = null">{{ t('common.cancel') }}</button></div>
      </form>

      <div class="card divide-y divide-line">
        <p v-if="!items.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.dict.empty') }}</p>
        <div v-for="it in items" :key="it._id" class="flex items-start gap-3 p-3">
          <code class="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-ink-soft">{{ preview(it) }}</code>
          <button class="btn-icon btn" :aria-label="t('common.edit')" @click="edit(it)"><Icon name="pen" :size="16" /></button>
          <button class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="remove(it)"><Icon name="trash" :size="16" /></button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te } = useI18n()
const dictionaries = ref<string[]>([])
const current = ref('')
const items = ref<any[]>([])
const editing = ref<{ id: string | null; json: string } | null>(null)
const editError = ref('')

// Record shapes for the JSON editor (validated by the server-side schema)
const examples: Record<string, string> = {
  brvValues: '{ "value": 440000, "validFrom": "2026-09-01", "source": "УП-115" }',
  feeRates: '{ "code": "property", "kind": "percent", "percent": 2, "minBrv": 1, "smeDiscount": true, "name": { "ru": "...", "uz": "..." } }',
  calendarDays: '{ "date": "2026-03-20", "type": "holiday", "name": { "ru": "Рамазан Хайит", "uz": "Ramazon hayit" } }',
  courts: '{ "name": { "ru": "...", "uz": "..." }, "level": "district", "region": "Ташкент" }',
  deadlineRules: '{ "code": "appeal_filing", "trigger": "...", "amount": 1, "unit": "months", "articleRef": "ЭПК, ст. 261" }',
  norms: '{ "code": "ЭПК", "article": "151", "title": { "ru": "...", "uz": "..." }, "text": { "ru": "...", "uz": "..." } }',
  bodies: '{ "code": "prosecutor_city", "kind": "prosecutor", "name": { "ru": "...", "uz": "..." } }',
  skills: '{ "key": "claim.prayer", "parentKey": "claim", "name": { "ru": "...", "uz": "..." } }'
}

const strip = (it: any) => { const { _id, __v, createdAt, updatedAt, ...rest } = it; return rest }
const preview = (it: any) => JSON.stringify(strip(it))

onMounted(async () => {
  const { data } = await apiClient.get('/admin/dictionaries')
  dictionaries.value = data.dictionaries
})
async function open(name: string) {
  current.value = name
  editing.value = null
  const { data } = await apiClient.get(`/admin/dictionaries/${name}`)
  items.value = data.items
}
function edit(it: any | null) {
  editError.value = ''
  editing.value = { id: it?._id ?? null, json: it ? JSON.stringify(strip(it), null, 2) : '{\n  \n}' }
}
async function saveItem() {
  if (!editing.value) return
  editError.value = ''
  let body: unknown
  try { body = JSON.parse(editing.value.json) } catch { editError.value = t('admin.dict.badJson'); return }
  try {
    if (editing.value.id) await apiClient.put(`/admin/dictionaries/${current.value}/${editing.value.id}`, body)
    else await apiClient.post(`/admin/dictionaries/${current.value}`, body)
    editing.value = null
    toast(t('common.saved'), 'ok')
    open(current.value)
  } catch (e: any) {
    editError.value = e?.response?.data?.error?.message || t('errors.generic')
  }
}
// New bodies from the open register are added, names of the imported ones refreshed; kinds edited here stay
const importing = ref(false)
async function importRegister() {
  importing.value = true
  try {
    const { data } = await apiClient.post('/admin/dictionaries/bodies/import-register')
    toast(t('admin.dict.imported', { added: data.added, updated: data.updated }), 'ok')
    open('bodies')
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    importing.value = false
  }
}
async function remove(it: any) {
  if (!window.confirm(t('admin.dict.confirmDelete'))) return
  await apiClient.delete(`/admin/dictionaries/${current.value}/${it._id}`)
  toast(t('common.deleted'), 'ok')
  open(current.value)
}
</script>
