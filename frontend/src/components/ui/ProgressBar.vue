<template>
  <div class="w-full overflow-hidden rounded-full" :style="{ height: `${height}px`, background: track }"
    role="progressbar" :aria-valuenow="Math.round(value)" aria-valuemin="0" aria-valuemax="100" :aria-label="label">
    <i class="block h-full rounded-full transition-[width] duration-1000 ease-out" :style="{ width: `${shown}%`, background: color }" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ value: number; color?: string; track?: string; height?: number; label?: string }>(),
  { color: 'var(--brand)', track: 'var(--line)', height: 8, label: '' })

// Fills from zero when it first appears
const shown = ref(0)
onMounted(() => requestAnimationFrame(() => { shown.value = Math.max(0, Math.min(100, props.value)) }))
watch(() => props.value, v => { shown.value = Math.max(0, Math.min(100, v)) })
</script>
