<template>
  <!-- Full-screen "the case is being written" state while a task starts; steps change every ~0.8 s -->
  <Transition name="fade">
    <div v-if="generating" class="fixed inset-0 z-50 grid place-items-center bg-white/85 px-6 backdrop-blur-sm" role="status" aria-live="polite">
      <div class="card flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
        <span class="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="sparkles" :size="26" class="pulse-soft" /></span>
        <h2 class="text-lg font-bold">{{ t('generating.title') }}</h2>
        <ul class="flex w-full flex-col gap-2 text-left text-sm">
          <li v-for="(s, i) in steps" :key="s" class="flex items-center gap-2" :class="i < step ? 'text-ink' : i === step ? 'font-semibold text-brand-dark' : 'text-ink-mute'">
            <Icon :name="i < step ? 'check' : 'dot'" :size="16" />
            {{ s }}
          </li>
        </ul>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-brand-tint">
          <div class="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" :style="{ width: `${Math.min(95, ((step + 1) / steps.length) * 100)}%` }" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { generating } from '@/utils/tasks'

const { t, tm, rt } = useI18n()
const steps = computed(() => (tm('generating.steps') as any[]).map(s => rt(s)))
const step = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

watch(generating, on => {
  if (timer) clearInterval(timer)
  step.value = 0
  if (on) timer = setInterval(() => { if (step.value < steps.value.length - 1) step.value++ }, 800)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
