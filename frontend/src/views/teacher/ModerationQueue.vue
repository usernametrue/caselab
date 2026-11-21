<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('teacher.mod.title') }}</h1>
      <p class="mt-1 text-sm text-ink-soft">{{ t('teacher.mod.lead') }}</p>
    </div>
    <p v-if="!queue.length" class="card p-6 text-center text-sm text-ink-mute">{{ t('teacher.mod.empty') }}</p>
    <div class="card divide-y divide-line">
      <RouterLink v-for="q in queue" :key="q.id" :to="`${base}/${q.id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <div class="min-w-0 flex-1">
          <div class="font-semibold">{{ q.title }}</div>
          <div class="text-xs text-ink-mute">{{ q.student }} · {{ t(`taskTypes.${q.taskType}`) }}</div>
          <div v-if="q.dispute" class="mt-1 line-clamp-1 text-xs text-warn-dark">{{ t('teacher.mod.dispute') }}: {{ q.dispute }}</div>
        </div>
        <span v-if="q.isExam" class="chip chip-warn">{{ t('task.exam') }}</span>
        <span v-for="r in q.reviewReasons" :key="r" class="chip chip-muted">{{ t(`admin.results.reasons.${r}`) }}</span>
        <span class="chip chip-brand">{{ q.finalScore ?? '-' }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'

// Shared by the teacher cabinet and the admin panel; links follow the current section
const { t } = useI18n()
const route = useRoute()
const base = computed(() => (route.path.startsWith('/admin') ? '/admin/moderation' : '/teacher/moderation'))
const queue = ref<any[]>([])
onMounted(async () => { queue.value = (await apiClient.get('/teacher/moderation/queue')).data.queue })
</script>
