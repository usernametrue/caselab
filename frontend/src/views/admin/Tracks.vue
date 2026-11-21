<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.tracks.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.tracks.lead') }}</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost" @click="genOpen = !genOpen"><Icon name="sparkles" :size="18" /> {{ t('admin.tracks.generate') }}</button>
        <RouterLink to="/admin/tracks/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.tracks.create') }}</RouterLink>
      </div>
    </div>

    <!-- AI draft: the track and its templates are saved as drafts -->
    <form v-if="genOpen" class="card grid gap-4 p-5 sm:grid-cols-3" @submit.prevent="generate">
      <p class="text-sm text-ink-soft sm:col-span-3">{{ t('admin.tracks.generateLead') }}</p>
      <div class="sm:col-span-3"><label class="label" for="tg-topic">{{ t('admin.docs.topic') }}</label>
        <input id="tg-topic" v-model="gen.topic" class="input" :placeholder="t('admin.tracks.topicHint')" /></div>
      <div><label class="label" for="tg-lang">{{ t('common.language') }}</label>
        <select id="tg-lang" v-model="gen.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div><label class="label" for="tg-n">{{ t('admin.tracks.stagesCount') }}</label><input id="tg-n" v-model.number="gen.stagesCount" type="number" min="3" max="6" class="input" /></div>
      <div class="flex items-end"><button class="btn btn-primary" :disabled="generating || gen.topic.length < 5">{{ generating ? t('admin.docs.generating') : t('admin.docs.generateRun') }}</button></div>
    </form>

    <AiJobs kind="generate_track" :refresh-key="jobsKey" />

    <div class="card divide-y divide-line">
      <p v-if="!tracks.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.tracks.empty') }}</p>
      <RouterLink v-for="tr in tracks" :key="tr._id" :to="`/admin/tracks/${tr._id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ tr.title[lang] || tr.title.ru || tr.title.uz }}</span>
        <span class="chip chip-outline">{{ t('train.stagesCount', { n: tr.stagesCount }) }}</span>
        <span class="chip chip-outline">{{ t('admin.tracks.runs', { n: tr.runs }) }}</span>
        <span v-if="tr.source === 'ai'" class="chip chip-brand"><Icon name="sparkles" :size="13" /> {{ t('admin.docs.ai') }}</span>
        <span class="chip" :class="tr.status === 'published' ? 'chip-ok' : tr.status === 'review' ? 'chip-warn' : 'chip-muted'">{{ t(`admin.templates.statuses.${tr.status}`) }}</span>
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
import { apiClient, apiErrorCode, LLM_TIMEOUT } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te, locale } = useI18n()
const router = useRouter()
const lang = computed(() => locale.value as 'ru' | 'uz')
const tracks = ref<any[]>([])
const genOpen = ref(false)
const generating = ref(false)
const jobsKey = ref(0)
const gen = reactive({ topic: '', language: 'ru', stagesCount: 4 })
onMounted(async () => { tracks.value = (await apiClient.get('/admin/tracks')).data.tracks })

async function generate() {
  generating.value = true
  try {
    const { data, status } = await apiClient.post('/admin/tracks/generate', gen, { timeout: LLM_TIMEOUT })
    // Sent with the next batch: the draft shows up in the list when it is ready
    if (status === 202) {
      toast(t('ai.queued'), 'ok', 5000)
      genOpen.value = false
      jobsKey.value++
      return
    }
    toast(t('admin.tracks.generated'), 'ok')
    router.push(`/admin/tracks/${data.track._id}`)
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    generating.value = false
  }
}
</script>
