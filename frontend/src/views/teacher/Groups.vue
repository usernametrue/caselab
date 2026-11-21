<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('teacher.groups.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('teacher.groups.lead') }}</p>
      </div>
      <form class="flex gap-2" @submit.prevent="create">
        <input v-model.trim="name" class="input" :placeholder="t('teacher.groups.namePlaceholder')" :aria-label="t('teacher.groups.name')" />
        <button class="btn btn-primary" :disabled="name.length < 2"><Icon name="plus" :size="18" /> {{ t('teacher.groups.create') }}</button>
      </form>
    </div>
    <p v-if="!groups.length" class="card p-6 text-center text-sm text-ink-mute">{{ t('teacher.groups.empty') }}</p>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink v-for="g in groups" :key="g.id" :to="`/teacher/groups/${g.id}`" class="card lift p-5">
        <div class="font-bold">{{ g.name }}</div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="chip chip-brand">{{ t('teacher.groups.students', { n: g.studentsCount }) }}</span>
          <span class="chip chip-outline font-mono">{{ g.inviteCode }}</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t } = useI18n()
const groups = ref<any[]>([])
const name = ref('')
async function load() { groups.value = (await apiClient.get('/teacher/groups')).data.groups }
async function create() {
  await apiClient.post('/teacher/groups', { name: name.value })
  name.value = ''
  toast(t('common.saved'), 'ok')
  load()
}
onMounted(load)
</script>
