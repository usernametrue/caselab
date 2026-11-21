<template>
  <!-- Choice of a linked record with search, plus "edit" and "create" in the side panel without leaving the editor -->
  <div class="flex flex-col gap-1.5">
    <div class="flex gap-2">
      <select :id="inputId" class="input min-w-0 flex-1" :value="modelValue ?? ''" @change="onSelect(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>{{ placeholder || '-' }}</option>
        <option v-for="o in filtered" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>
      <button v-if="modelValue && editable" type="button" class="btn btn-ghost shrink-0 !px-3" :title="t('admin.links.edit')" :aria-label="t('admin.links.edit')" @click="open(modelValue)">
        <Icon name="pen" :size="16" />
      </button>
      <button v-if="editable" type="button" class="btn btn-ghost shrink-0 !px-3" :title="t('admin.links.create')" :aria-label="t('admin.links.create')" @click="open('new')">
        <Icon name="plus" :size="16" />
      </button>
    </div>
    <input v-if="options.length > 8" v-model="query" class="input !py-1.5 text-sm" :placeholder="t('admin.links.search')" :aria-label="t('admin.links.search')" />
    <EntityDrawer :kind="drawerId ? kind : null" :id="drawerId" @close="drawerId = ''" @saved="onSaved" @deleted="onDeleted" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import EntityDrawer, { type EntityKind } from '@/components/ui/EntityDrawer.vue'

export interface PickerOption { id: string; label: string }

// editable = false: only the choice (teachers have no access to the admin editors)
const props = withDefaults(defineProps<{ kind: EntityKind; modelValue: string | null; options: PickerOption[]; placeholder?: string; inputId?: string; editable?: boolean }>(), { placeholder: '', inputId: undefined, editable: true })
const emit = defineEmits<{ 'update:modelValue': [id: string | null]; changed: [] }>()
const { t } = useI18n()

const query = ref('')
const drawerId = ref('')
// The chosen option always stays in the list, even when the search hides it
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(o => o.id === props.modelValue || o.label.toLowerCase().includes(q))
})

function onSelect(id: string) { emit('update:modelValue', id || null) }
function open(id: string) { drawerId.value = id }
// The parent reloads its list; a record created in the panel becomes the choice
function onSaved(e: { id: string }) {
  emit('changed')
  if (drawerId.value === 'new' || props.modelValue !== e.id) emit('update:modelValue', e.id)
}
function onDeleted() {
  emit('changed')
  emit('update:modelValue', null)
}
</script>
