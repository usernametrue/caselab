<template>
  <RouterLink :to="to" class="flex items-center gap-[10px] font-extrabold no-underline" :class="light ? 'text-white' : 'text-ink'"
    aria-label="CaseLab - на главную">
    <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-press">
      <Icon name="scale" :size="20" />
    </span>
    <span class="text-xl tracking-tight" :class="{ 'hidden sm:inline': compact }">CaseLab</span>
  </RouterLink>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

// compact: mark only below sm, where the header has no room for the word
withDefaults(defineProps<{ to?: string; light?: boolean; compact?: boolean }>(), { to: '/', light: false, compact: false })
</script>
