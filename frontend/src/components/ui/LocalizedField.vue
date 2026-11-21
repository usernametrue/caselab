<template>
  <div>
    <div class="label">{{ label }}</div>
    <div class="grid gap-2 md:grid-cols-2">
      <div v-for="l in ['ru', 'uz'] as const" :key="l" class="relative">
        <span class="pointer-events-none absolute right-3 top-2 text-[11px] font-bold text-ink-mute">{{ l.toUpperCase() }}</span>
        <textarea v-if="multiline" class="input pr-10" :rows="rows" :value="modelValue?.[l] ?? ''" :aria-label="`${label} ${l}`"
          @input="update(l, ($event.target as HTMLTextAreaElement).value)" />
        <input v-else class="input pr-10" :value="modelValue?.[l] ?? ''" :aria-label="`${label} ${l}`"
          @input="update(l, ($event.target as HTMLInputElement).value)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Two side-by-side fields for { ru, uz } content
const props = withDefaults(defineProps<{ modelValue: { ru: string; uz: string }; label: string; multiline?: boolean; rows?: number }>(), { multiline: false, rows: 4 })
const emit = defineEmits<{ 'update:modelValue': [value: { ru: string; uz: string }] }>()
const update = (l: 'ru' | 'uz', v: string) => emit('update:modelValue', { ...(props.modelValue ?? { ru: '', uz: '' }), [l]: v })
</script>
