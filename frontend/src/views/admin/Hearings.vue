<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.hear.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.hear.lead') }}</p>
      </div>
      <RouterLink to="/admin/hearings/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.hear.create') }}</RouterLink>
    </div>
    <div class="card divide-y divide-line">
      <p v-if="!items.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.hear.empty') }}</p>
      <RouterLink v-for="h in items" :key="h._id" :to="`/admin/hearings/${h._id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ h.title }}</span>
        <span class="chip chip-outline">{{ t('admin.hear.participantsCount', { n: h.participantsCount }) }}</span>
        <span class="chip chip-outline">{{ t('admin.hear.stagesCount', { n: h.stagesCount }) }}</span>
        <span class="chip" :class="h.status === 'published' ? 'chip-ok' : 'chip-muted'">{{ t(`admin.templates.statuses.${h.status}`) }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'

const { t } = useI18n()
const items = ref<any[]>([])
onMounted(async () => { items.value = (await apiClient.get('/admin/hearings')).data.hearings })
</script>
