<template>
  <!-- "Where it is used": templates that use a document or a scenario, tracks that use a template -->
  <div v-if="loaded" class="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm">
    <span class="flex items-center gap-1 font-semibold text-ink-soft"><Icon name="link" :size="15" /> {{ t('admin.links.usedBy') }}:</span>
    <span v-if="!items.length" class="text-ink-mute">{{ t('admin.links.unused') }}</span>
    <component :is="embedded ? 'a' : 'RouterLink'" v-for="i in items" :key="`${i.kind}-${i.id}`" :to="embedded ? undefined : pathOf(i)" :href="embedded ? pathOf(i) : undefined"
      :target="embedded ? '_blank' : undefined" class="chip chip-outline hover:border-brand/50 hover:text-brand-dark">
      <Icon :name="iconOf(i.kind)" :size="13" /> {{ i.title || i.id }}
      <span v-if="i.status !== 'published'" class="text-ink-mute">· {{ t(`admin.templates.statuses.${i.status}`) }}</span>
      <Icon v-if="embedded" name="external" :size="12" />
    </component>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient } from '@/plugins/axios'

const props = defineProps<{ kind: 'document' | 'template' | 'scenario' | 'hearing'; id: string; embedded?: boolean }>()
const { t, locale } = useI18n()
const items = ref<{ kind: string; id: string; title: string; status: string }[]>([])
const loaded = ref(false)

const PATHS: Record<string, string> = { template: '/admin/templates', track: '/admin/tracks', document: '/admin/documents' }
const ICONS: Record<string, string> = { template: 'file', track: 'briefcase', document: 'book' }
const pathOf = (i: { kind: string; id: string }) => `${PATHS[i.kind]}/${i.id}`
const iconOf = (kind: string) => ICONS[kind] ?? 'file'

async function load() {
  if (!props.id || props.id === 'new') return
  try {
    items.value = (await apiClient.get(`/admin/usage/${props.kind}/${props.id}`, { params: { locale: locale.value } })).data.items
    loaded.value = true
  } catch { loaded.value = false }
}
watch(() => props.id, load)
onMounted(load)
</script>
