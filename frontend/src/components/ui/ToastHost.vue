<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
    <TransitionGroup name="fade">
      <div v-for="t in toasts" :key="t.id"
        class="pointer-events-auto flex w-full max-w-[420px] items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lift"
        :class="kindClass[t.kind]">
        <Icon :name="kindIcon[t.kind]" :size="18" />
        <span>{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import { toasts } from './toast'

const kindClass = { info: 'bg-ink text-white', ok: 'bg-ok text-white', bad: 'bg-bad text-white', achievement: 'bg-sun text-ink' }
const kindIcon = { info: 'check', ok: 'check', bad: 'x', achievement: 'trophy' }
</script>
