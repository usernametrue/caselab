<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.docs.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.docs.lead') }}</p>
      </div>
      <div class="flex gap-2">
        <label class="btn btn-ghost cursor-pointer"><Icon name="file" :size="18" /> {{ importing ? t('common.loading') : t('admin.docs.importDocx') }}
          <input type="file" accept=".docx" class="sr-only" :disabled="importing" @change="importDocx" /></label>
        <button class="btn btn-ghost" @click="genOpen = !genOpen"><Icon name="sparkles" :size="18" /> {{ t('admin.docs.generate') }}</button>
        <RouterLink to="/admin/documents/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.docs.create') }}</RouterLink>
      </div>
    </div>

    <!-- AI draft: saved as a draft, students see it only after review and publication -->
    <form v-if="genOpen" class="card grid gap-4 p-5 sm:grid-cols-2" @submit.prevent="generate">
      <p class="sm:col-span-2 text-sm text-ink-soft">{{ t('admin.docs.generateLead') }}</p>
      <div><label class="label" for="g-type">{{ t('admin.docs.type') }}</label>
        <select id="g-type" v-model="gen.type" class="input"><option v-for="ty in types" :key="ty" :value="ty">{{ t(`admin.docs.types.${ty}`) }}</option></select></div>
      <div><label class="label" for="g-lang">{{ t('common.language') }}</label>
        <select id="g-lang" v-model="gen.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div class="sm:col-span-2"><label class="label" for="g-topic">{{ t('admin.docs.topic') }}</label>
        <input id="g-topic" v-model="gen.topic" class="input" :placeholder="t('admin.docs.topicHint')" /></div>
      <div v-for="(p, i) in gen.parties" :key="i" class="grid grid-cols-[120px_1fr] gap-2 sm:col-span-2">
        <input v-model.trim="p.key" class="input" :aria-label="t('admin.docs.partyKey')" placeholder="customer" />
        <input v-model="p.name[gen.language]" class="input" :aria-label="t('admin.docs.partyName')" :placeholder="t('admin.docs.partyName')" />
      </div>
      <div><label class="label" for="g-flaws">{{ t('admin.docs.flawsCount') }}</label><input id="g-flaws" v-model.number="gen.flawsCount" type="number" min="1" max="12" class="input" /></div>
      <div><label class="label" for="g-edits">{{ t('admin.docs.editsCount') }}</label><input id="g-edits" v-model.number="gen.editsCount" type="number" min="0" max="8" class="input" /></div>
      <div><label class="label" for="g-dif">{{ t('admin.templates.difficulty') }}</label>
        <select id="g-dif" v-model.number="gen.difficulty" class="input"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select></div>
      <div class="flex items-end gap-2"><button class="btn btn-primary" :disabled="generating || gen.topic.length < 5">{{ generating ? t('admin.docs.generating') : t('admin.docs.generateRun') }}</button></div>
      <p v-if="genError" class="sm:col-span-2 rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ genError }}</p>
    </form>

    <AiJobs kind="generate_document,inject_errors" :refresh-key="jobsKey" />

    <div class="card divide-y divide-line">
      <p v-if="!docs.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.docs.empty') }}</p>
      <RouterLink v-for="d in docs" :key="d._id" :to="`/admin/documents/${d._id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ d.title }}</span>
        <span class="chip chip-outline">{{ t(`admin.docs.types.${d.type}`) }}</span>
        <span class="chip chip-outline">{{ t('admin.docs.counts', { f: d.flawsCount, e: d.editsCount }) }}</span>
        <span v-if="d.source === 'ai'" class="chip chip-brand"><Icon name="sparkles" :size="13" /> {{ t('admin.docs.ai') }}</span>
        <span class="chip" :class="d.status === 'published' ? 'chip-ok' : 'chip-muted'">{{ t(`admin.templates.statuses.${d.status}`) }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import AiJobs from '@/components/ui/AiJobs.vue'
import { apiClient, apiErrorCode, LLM_TIMEOUT } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te } = useI18n()
const router = useRouter()
const types = ['contract', 'labor_contract', 'admin_act', 'court_act', 'claim']
const docs = ref<any[]>([])

// ADM-8: the text of a DOCX opens in a new document; flaws are marked there before saving
const importing = ref(false)
async function importDocx(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const { data } = await apiClient.post('/admin/import/docx', { fileName: file.name, contentBase64: btoa(bin) })
    try { sessionStorage.setItem('lh-docx-import', JSON.stringify(data)) } catch { /* storage unavailable */ }
    router.push('/admin/documents/new')
  } catch (err) {
    const code = apiErrorCode(err)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    importing.value = false
  }
}
const genOpen = ref(false)
const generating = ref(false)
const genError = ref('')
const jobsKey = ref(0)
const gen = reactive<any>({
  type: 'contract', language: 'ru', topic: '', flawsCount: 5, editsCount: 3, difficulty: 3,
  parties: [{ key: 'customer', name: { ru: 'Заказчик', uz: 'Buyurtmachi' } }, { key: 'contractor', name: { ru: 'Подрядчик', uz: 'Pudratchi' } }]
})

async function load() {
  const { data } = await apiClient.get('/admin/documents')
  docs.value = data.documents
}
async function generate() {
  generating.value = true
  genError.value = ''
  try {
    const { data, status } = await apiClient.post('/admin/documents/generate', gen, { timeout: LLM_TIMEOUT })
    // Sent with the next batch: the draft shows up in the list when it is ready
    if (status === 202) {
      toast(t('ai.queued'), 'ok', 5000)
      genOpen.value = false
      jobsKey.value++
      return
    }
    const dropped = data.dropped.flaws + data.dropped.counterpartyEdits
    toast(dropped ? t('admin.docs.generatedDropped', { n: dropped }) : t('admin.docs.generated'), 'ok', 4500)
    router.push(`/admin/documents/${data.document._id}`)
  } catch (e) {
    const code = apiErrorCode(e)
    genError.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    generating.value = false
  }
}
onMounted(load)
</script>
