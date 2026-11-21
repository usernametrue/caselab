<template>
  <div class="flex min-h-screen flex-col bg-paper">
    <header class="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6">
      <Logo to="/app" />
      <LanguageSwitch />
    </header>
    <main class="mx-auto w-full max-w-lesson flex-1 px-4 pb-16 pt-6 sm:pt-10">
      <span class="eyebrow">{{ t('onboarding.eyebrow') }}</span>
      <h1 class="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{{ t('onboarding.title') }}</h1>
      <p class="mt-3 text-ink-soft">{{ t('onboarding.lead') }}</p>
      <div class="mt-6 flex flex-col gap-3" role="radiogroup">
        <button v-for="lvl in levels" :key="lvl" type="button" class="option" :class="{ 'is-selected': chosen === lvl }"
          role="radio" :aria-checked="chosen === lvl" @click="chosen = lvl">
          <span class="text">
            <span class="block font-bold">{{ t(`onboarding.${lvl}.title`) }}</span>
            <span class="block text-sm text-ink-soft">{{ t(`onboarding.${lvl}.text`) }}</span>
          </span>
        </button>
      </div>
      <button class="btn btn-primary mt-6" :disabled="!chosen || busy" @click="save">{{ t('onboarding.continue') }}</button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Logo from '@/components/ui/Logo.vue'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/ui/toast'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const levels = ['beginner', 'intermediate', 'advanced'] as const
const chosen = ref<string | null>(null)
const busy = ref(false)

async function save() {
  busy.value = true
  try {
    await auth.update({ startLevel: chosen.value })
    router.push({ name: 'Dashboard' })
  } catch {
    toast(t('errors.generic'), 'bad')
  } finally {
    busy.value = false
  }
}
</script>
