<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.scoring.title') }}</h1>
      <p class="mt-1 text-sm text-ink-soft">{{ t('admin.scoring.lead') }}</p>
    </div>
    <div class="grid gap-4 md:grid-cols-2">
      <form v-for="c in configs" :key="c.mode" class="card p-5" @submit.prevent="save(c)">
        <h2 class="font-bold">{{ t(`modes.${c.mode}.title`) }}</h2>
        <div class="mt-4 flex flex-col gap-3">
          <div v-for="k in criteria" :key="k" class="flex items-center justify-between gap-3">
            <label class="text-sm" :for="`${c.mode}-${k}`">{{ t(`result.criteria.${k}`) }}</label>
            <input :id="`${c.mode}-${k}`" v-model.number="c.weights[k]" type="number" min="0" max="100" class="input !w-24 !py-2 text-right" />
          </div>
        </div>
        <div class="mt-4 flex items-center justify-between">
          <span class="text-sm font-semibold" :class="sum(c) === 100 ? 'text-ok-dark' : 'text-bad-dark'">{{ t('admin.scoring.sum', { n: sum(c) }) }}</span>
          <button class="btn btn-primary" :disabled="sum(c) !== 100">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t } = useI18n()
const criteria = ['accuracy', 'completeness', 'reasoning', 'form', 'language']
const configs = ref<{ mode: string; weights: Record<string, number> }[]>([])
const sum = (c: { weights: Record<string, number> }) => criteria.reduce((a, k) => a + (Number(c.weights[k]) || 0), 0)

onMounted(async () => {
  const { data } = await apiClient.get('/admin/scoring')
  configs.value = data.configs
})
async function save(c: { mode: string; weights: Record<string, number> }) {
  await apiClient.put(`/admin/scoring/${c.mode}`, c.weights)
  toast(t('common.saved'), 'ok')
}
</script>
