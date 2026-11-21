<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('teacher.content.title') }}</h1>
      <p class="mt-1 text-sm text-ink-soft">{{ t('teacher.content.lead') }}</p>
      <div class="mt-3 flex flex-wrap gap-2"><ContentImport endpoint="/teacher/content/import" target="#import-report" @done="load" /></div>
      <p class="mt-1 text-xs text-ink-mute">{{ t('pack.teacherHint') }}</p>
    </div>
    <div id="import-report" class="contents" />

    <section class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.nav.templates') }}</h2>
        <RouterLink to="/teacher/templates/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.templates.create') }}</RouterLink>
      </div>
      <p v-if="!templates.length" class="mt-3 text-sm text-ink-mute">{{ t('teacher.content.noTemplates') }}</p>
      <div class="mt-3 divide-y divide-line">
        <RouterLink v-for="tpl in templates" :key="tpl._id" :to="`/teacher/templates/${tpl._id}`" class="flex flex-wrap items-center gap-3 py-3 hover:text-brand">
          <span class="min-w-0 flex-1 font-semibold">{{ tpl.title[lang] || tpl.title.ru || tpl.title.uz }}</span>
          <span class="chip chip-outline">{{ t(`taskTypes.${tpl.taskType}`) }}</span>
          <span class="chip" :class="statusClass(tpl.status)">{{ t(`admin.templates.statuses.${tpl.status}`) }}</span>
        </RouterLink>
      </div>
    </section>

    <section class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.nav.documents') }}</h2>
        <RouterLink to="/teacher/documents/new" class="btn btn-ghost"><Icon name="plus" :size="18" /> {{ t('admin.docs.create') }}</RouterLink>
      </div>
      <p v-if="!documents.length" class="mt-3 text-sm text-ink-mute">{{ t('teacher.content.noDocuments') }}</p>
      <div class="mt-3 divide-y divide-line">
        <RouterLink v-for="d in documents" :key="d._id" :to="`/teacher/documents/${d._id}`" class="flex flex-wrap items-center gap-3 py-3 hover:text-brand">
          <span class="min-w-0 flex-1 font-semibold">{{ d.title }}</span>
          <span class="chip chip-outline">{{ t(`admin.docs.types.${d.type}`) }}</span>
          <span class="chip" :class="statusClass(d.status)">{{ t(`admin.templates.statuses.${d.status}`) }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import ContentImport from '@/components/ui/ContentImport.vue'
import { apiClient } from '@/plugins/axios'

const { t, locale } = useI18n()
const lang = computed(() => locale.value as 'ru' | 'uz')
const templates = ref<any[]>([])
const documents = ref<any[]>([])
const statusClass = (s: string) => (s === 'published' ? 'chip-ok' : s === 'review' ? 'chip-warn' : 'chip-muted')
async function load() {
  const [a, b] = await Promise.all([apiClient.get('/teacher/content/templates'), apiClient.get('/teacher/content/documents')])
  templates.value = a.data.templates
  documents.value = b.data.documents
}
onMounted(load)
</script>
