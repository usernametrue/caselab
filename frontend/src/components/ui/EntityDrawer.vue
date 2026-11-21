<template>
  <!-- Side panel with the editor of a linked record: a template from a track stage, a document or a scenario from a template.
       Saving keeps the panel open and tells the parent the id, so a new record is picked right away. -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="kind" class="fixed inset-0 z-50 flex justify-end bg-ink/40" @click.self="close">
        <aside class="flex h-full w-full max-w-[980px] flex-col bg-paper shadow-2xl" role="dialog" aria-modal="true">
          <div class="flex items-center justify-between gap-3 border-b border-line bg-white px-5 py-3">
            <div class="flex min-w-0 items-center gap-2 text-sm">
              <span class="chip chip-brand">{{ t(`admin.links.kinds.${kind}`) }}</span>
              <span v-if="currentId !== 'new'" class="truncate text-ink-mute">{{ currentId }}</span>
            </div>
            <div class="flex items-center gap-2">
              <a v-if="currentId !== 'new'" :href="pagePath" target="_blank" class="btn btn-ghost !py-1.5 text-sm"><Icon name="external" :size="15" /> {{ t('admin.links.openPage') }}</a>
              <button type="button" class="btn-icon btn" :aria-label="t('common.close')" @click="close"><Icon name="x" :size="20" /></button>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-5">
            <component :is="editor" :id="currentId" :key="`${kind}-${id}`" embedded @saved="onSaved" @deleted="onDeleted" />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'

export type EntityKind = 'template' | 'document' | 'scenario' | 'hearing'

const props = defineProps<{ kind: EntityKind | null; id: string }>()
const emit = defineEmits<{ close: []; saved: [entity: { id: string; title: string }]; deleted: [] }>()
const { t } = useI18n()

// Loaded on demand: the template editor itself opens this panel for its document or scenario
const EDITORS = {
  template: defineAsyncComponent(() => import('@/views/admin/TemplateEdit.vue')),
  document: defineAsyncComponent(() => import('@/views/admin/DocumentEdit.vue')),
  scenario: defineAsyncComponent(() => import('@/views/admin/ScenarioEdit.vue')),
  hearing: defineAsyncComponent(() => import('@/views/admin/HearingEdit.vue'))
}
const PAGES: Record<EntityKind, string> = { template: '/admin/templates', document: '/admin/documents', scenario: '/admin/scenarios', hearing: '/admin/hearings' }

const savedId = ref('')
const currentId = computed(() => savedId.value || props.id)
const editor = computed(() => (props.kind ? EDITORS[props.kind] : null))
const pagePath = computed(() => (props.kind ? `${PAGES[props.kind]}/${currentId.value}` : '#'))

watch(() => [props.kind, props.id], () => { savedId.value = '' })

function onSaved(e: { id: string; title: string }) {
  savedId.value = e.id
  emit('saved', e)
}
function onDeleted() {
  emit('deleted')
  close()
}
function close() { emit('close') }

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && props.kind) close() }
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
