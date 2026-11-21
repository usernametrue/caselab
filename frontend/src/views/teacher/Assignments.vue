<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('teacher.assign.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('teacher.assign.lead') }}</p>
      </div>
      <button class="btn btn-primary" @click="open = !open"><Icon name="plus" :size="18" /> {{ t('teacher.assign.create') }}</button>
    </div>

    <form v-if="open" class="card grid gap-4 p-5 sm:grid-cols-2" @submit.prevent="create">
      <div><label class="label" for="as-title">{{ t('teacher.assign.name') }}</label><input id="as-title" v-model.trim="form.title" class="input" /></div>
      <div><label class="label" for="as-group">{{ t('teacher.assign.group') }}</label>
        <select id="as-group" v-model="form.groupId" class="input"><option value="" disabled>-</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select></div>
      <div><label class="label" for="as-kind">{{ t('teacher.assign.kind') }}</label>
        <select id="as-kind" v-model="form.kind" class="input"><option value="training">{{ t('dashboard.kind.training') }}</option><option value="exam">{{ t('dashboard.kind.exam') }}</option></select>
        <p class="mt-1 text-xs text-ink-mute">{{ form.kind === 'exam' ? t('teacher.assign.examHint') : t('teacher.assign.trainingHint') }}</p></div>
      <div><label class="label" for="as-due">{{ t('teacher.assign.due') }}</label><input id="as-due" v-model="form.dueAt" type="datetime-local" class="input" /></div>
      <fieldset class="sm:col-span-2">
        <legend class="label">{{ t('teacher.assign.tasks') }}</legend>
        <p v-if="!templates.length" class="text-sm text-ink-mute">{{ t('teacher.assign.noTemplates') }}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-for="tpl in templates" :key="tpl.id" class="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm" :class="form.templateIds.includes(tpl.id) ? 'border-brand bg-brand-tint' : ''">
            <input v-model="form.templateIds" type="checkbox" :value="tpl.id" class="mt-1 h-4 w-4 accent-[#6A3DE8]" />
            <span><b>{{ tpl.title }}</b><span class="block text-xs text-ink-mute">{{ t(`taskTypes.${tpl.taskType}`) }} · {{ t('train.difficulty', { n: tpl.difficulty }) }}</span></span>
          </label>
        </div>
      </fieldset>
      <fieldset v-if="tracks.length" class="sm:col-span-2">
        <legend class="label">{{ t('teacher.assign.tracks') }}</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-for="tr in tracks" :key="tr.id" class="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm" :class="form.trackIds.includes(tr.id) ? 'border-brand bg-brand-tint' : ''">
            <input v-model="form.trackIds" type="checkbox" :value="tr.id" class="mt-1 h-4 w-4 accent-[#6A3DE8]" />
            <span><b>{{ tr.title }}</b><span class="block text-xs text-ink-mute">{{ t('train.stagesCount', { n: tr.stagesCount }) }}</span></span>
          </label>
        </div>
      </fieldset>
      <div class="flex gap-2 sm:col-span-2">
        <button class="btn btn-primary" :disabled="!canCreate">{{ t('common.save') }}</button>
        <button type="button" class="btn btn-ghost" @click="open = false">{{ t('common.cancel') }}</button>
      </div>
    </form>

    <p v-if="!assignments.length" class="card p-6 text-center text-sm text-ink-mute">{{ t('teacher.assign.empty') }}</p>
    <div class="card divide-y divide-line">
      <RouterLink v-for="a in assignments" :key="a.id" :to="`/teacher/assignments/${a.id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ a.title }}</span>
        <span class="chip" :class="a.kind === 'exam' ? 'chip-warn' : 'chip-outline'">{{ t(`dashboard.kind.${a.kind}`) }}</span>
        <span class="chip chip-outline">{{ a.groupName }}</span>
        <span v-if="a.kind === 'exam'" class="chip" :class="a.resultsPublished ? 'chip-ok' : 'chip-muted'">{{ a.resultsPublished ? t('teacher.assign.published') : t('teacher.assign.notPublished') }}</span>
        <span class="text-xs text-ink-mute">{{ new Date(a.dueAt).toLocaleString(locale === 'uz' ? 'uz-UZ' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te, locale } = useI18n()
const assignments = ref<any[]>([])
const groups = ref<any[]>([])
const templates = ref<any[]>([])
const open = ref(false)
const tracks = ref<any[]>([])
const form = reactive({ title: '', groupId: '', kind: 'training', dueAt: '', templateIds: [] as string[], trackIds: [] as string[] })
const canCreate = computed(() => form.title.length >= 3 && form.groupId && form.dueAt && form.templateIds.length + form.trackIds.length > 0)

async function load() {
  const [a, g, tpl] = await Promise.all([apiClient.get('/teacher/assignments'), apiClient.get('/teacher/groups'), apiClient.get('/teacher/templates')])
  assignments.value = a.data.assignments
  groups.value = g.data.groups
  templates.value = tpl.data.templates
  tracks.value = tpl.data.tracks ?? []
}
async function create() {
  try {
    // datetime-local has no zone: the browser's local time is sent as an absolute moment
    await apiClient.post('/teacher/assignments', { ...form, dueAt: new Date(form.dueAt).toISOString() })
    Object.assign(form, { title: '', templateIds: [], trackIds: [], dueAt: '' })
    open.value = false
    toast(t('common.saved'), 'ok')
    load()
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  }
}
onMounted(load)
</script>
