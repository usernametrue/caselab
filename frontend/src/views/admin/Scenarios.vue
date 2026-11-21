<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.scen.title') }}</h1>
        <p class="mt-1 text-sm text-ink-soft">{{ t('admin.scen.lead') }}</p>
      </div>
      <RouterLink to="/admin/scenarios/new" class="btn btn-primary"><Icon name="plus" :size="18" /> {{ t('admin.scen.create') }}</RouterLink>
    </div>
    <div class="card divide-y divide-line">
      <p v-if="!items.length" class="p-6 text-center text-sm text-ink-mute">{{ t('admin.scen.empty') }}</p>
      <RouterLink v-for="s in items" :key="s._id" :to="`/admin/scenarios/${s._id}`" class="flex flex-wrap items-center gap-3 p-4 hover:bg-brand-tint">
        <span class="min-w-0 flex-1 font-semibold">{{ s.title }}</span>
        <span class="chip chip-outline">{{ s.roles.map((r: any) => r.name).join(', ') }}</span>
        <span class="chip chip-outline">{{ t('admin.scen.nodesCount', { n: s.nodesCount }) }}</span>
        <span class="chip" :class="s.status === 'published' ? 'chip-ok' : 'chip-muted'">{{ t(`admin.templates.statuses.${s.status}`) }}</span>
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
onMounted(async () => { items.value = (await apiClient.get('/admin/scenarios')).data.scenarios })
</script>
