<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.templates.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.templates.lead') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <ContentImport endpoint="/admin/import" target="#import-report" @done="load" />
        <button class="btn btn-ghost" :disabled="exporting" @click="exportAll"><Icon name="file" :size="18" /> {{ exporting ? t('common.loading') : t('pack.export') }}</button>
        <button class="btn btn-ghost" @click="genOpen = !genOpen"><Icon name="sparkles" :size="18" /> {{ t('admin.templates.generate') }}</button>
        <RouterLink to="/admin/templates/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.templates.create') }}</RouterLink>
      </div>
    </div>

    <!-- AI draft of a template (PRD 10.2 generateTemplate): saved as a draft, a person checks and publishes -->
    <form v-if="genOpen" class="card grid gap-4 p-5 sm:grid-cols-3" @submit.prevent="generate">
      <p class="text-sm text-ink-soft sm:col-span-3">{{ t('admin.templates.generateLead') }}</p>
      <div class="sm:col-span-3"><label class="label" for="gt-topic">{{ t('admin.docs.topic') }}</label>
        <input id="gt-topic" v-model="gen.topic" class="input" :placeholder="t('admin.templates.topicHint')" /></div>
      <div><label class="label" for="gt-type">{{ t('admin.templates.taskType') }}</label>
        <select id="gt-type" v-model="gen.taskType" class="input"><option v-for="tt in GEN_TYPES" :key="tt" :value="tt">{{ t(`taskTypes.${tt}`) }}</option></select></div>
      <div><label class="label" for="gt-dif">{{ t('admin.templates.difficulty') }}</label>
        <select id="gt-dif" v-model.number="gen.difficulty" class="input"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select></div>
      <div><label class="label" for="gt-lang">{{ t('common.language') }}</label>
        <select id="gt-lang" v-model="gen.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div class="sm:col-span-3">
        <div class="label">{{ t('admin.templates.skills') }}</div>
        <div v-for="(_, i) in gen.skills" :key="i" class="mb-2 flex gap-2">
          <select v-model="gen.skills[i]" class="input" :aria-label="t('admin.templates.skills')">
            <option value="" disabled>-</option>
            <option v-for="sk in skillOptions" :key="sk.key" :value="sk.key">{{ sk.key }} - {{ sk.name[lang] || sk.name.ru }}</option>
          </select>
          <button v-if="gen.skills.length > 1" type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="gen.skills.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button v-if="gen.skills.length < 3" type="button" class="btn btn-ghost" @click="gen.skills.push('')"><Icon name="plus" :size="16" /> {{ t('admin.templates.addSkill') }}</button>
      </div>
      <div class="sm:col-span-3"><button class="btn btn-primary" :disabled="generating || gen.topic.length < 5 || gen.skills.some(k => !k)">{{ generating ? t('admin.docs.generating') : t('admin.docs.generateRun') }}</button></div>
    </form>
    <!-- Templates sent by teachers wait in "review" (TCH-5, ADM-7) -->
    <div class="flex flex-wrap gap-2">
      <button v-for="st in ['', 'review', 'draft', 'published']" :key="st" class="filter" :class="{ 'is-active': status === st }" @click="status = st; load()">{{ st ? t(`admin.templates.statuses.${st}`) : t('common.all') }}</button>
    </div>
    <div id="import-report" class="contents" />
    <AiJobs kind="generate_template" :refresh-key="jobsKey" />
    <div class="card divide-y divide-line">
      <p v-if="!templates.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.templates.empty') }}</p>
      <RouterLink v-for="tpl in templates" :key="tpl._id" :to="`/admin/templates/${tpl._id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ tpl.title[lang] || tpl.title.ru || tpl.title.uz }}</span>
        <span class="chip chip-outline">{{ t(`taskTypes.${tpl.taskType}`) }}</span>
        <span class="chip chip-outline">{{ t('train.difficulty', { n: tpl.difficulty }) }}</span>
        <span v-if="tpl.source === 'ai'" class="chip chip-brand"><Icon name="sparkles" :size="13" /> {{ t('admin.docs.ai') }}</span>
        <span class="chip" :class="tpl.status === 'published' ? 'chip-ok' : tpl.status === 'review' ? 'chip-warn' : 'chip-muted'">{{ t(`admin.templates.statuses.${tpl.status}`) }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import AiJobs from '@/components/ui/AiJobs.vue'
import ContentImport from '@/components/ui/ContentImport.vue'
import { apiClient, apiErrorCode, LLM_TIMEOUT } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te, locale } = useI18n()
const router = useRouter()
const lang = computed(() => locale.value as 'ru' | 'uz')
const templates = ref<any[]>([])
const status = ref('')
async function load() {
  const { data } = await apiClient.get('/admin/templates', { params: status.value ? { status: status.value } : {} })
  templates.value = data.templates
}
onMounted(async () => {
  await load()
  skillOptions.value = (await apiClient.get('/admin/dictionaries/skills')).data.items.filter((x: any) => x.parentKey)
})

// Task types the AI drafts whole; analysis uses a generated document, the simulation a scenario
const GEN_TYPES = ['draft_full', 'draft_part', 'proc_next_step', 'proc_draft', 'proc_timeline', 'route_and_apply']
const skillOptions = ref<any[]>([])
const genOpen = ref(false)
const generating = ref(false)
const jobsKey = ref(0)
const gen = reactive({ taskType: 'draft_full', topic: '', difficulty: 3, language: 'ru', skills: [''] as string[] })
async function generate() {
  generating.value = true
  try {
    const { data, status } = await apiClient.post('/admin/templates/generate', gen, { timeout: LLM_TIMEOUT })
    // Sent with the next batch: the draft shows up in the list when it is ready
    if (status === 202) {
      toast(t('ai.queued'), 'ok', 5000)
      genOpen.value = false
      jobsKey.value++
      return
    }
    toast(t(data.problems.length ? 'admin.templates.generatedProblems' : 'admin.templates.generated'), data.problems.length ? 'info' : 'ok')
    // The editor shows what the draft still lacks before it can be published
    router.push({ path: `/admin/templates/${data.template._id}`, state: { problems: data.problems } })
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    generating.value = false
  }
}

// ADM-8: { templates, documents, scenarios } - everything comes in as drafts
// The import itself lives in ContentImport (check of the whole file, then the write); the export gives the same format
const exporting = ref(false)
async function exportAll() {
  exporting.value = true
  try {
    const { data } = await apiClient.get('/admin/import/export', { timeout: 120000 })
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `caselab-content-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    const code = apiErrorCode(err)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    exporting.value = false
  }
}
</script>
