<template>
  <div class="min-h-screen bg-paper">
    <header class="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6">
      <Logo />
      <div class="flex items-center gap-2">
        <LanguageSwitch />
        <RouterLink to="/login" class="btn btn-link">{{ t('auth.signIn') }}</RouterLink>
      </div>
    </header>

    <section class="mx-auto max-w-content px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <div class="max-w-2xl animate-rise">
        <span class="eyebrow">{{ t('landing.eyebrow') }}</span>
        <h1 class="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.6rem]">
          {{ t('landing.title') }} <span class="text-brand">{{ t('landing.titleAccent') }}</span>
        </h1>
        <p class="mt-5 text-lg text-ink-soft">{{ t('landing.lead') }}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <RouterLink to="/register" class="btn btn-primary btn-lg">{{ t('landing.ctaRegister') }}</RouterLink>
          <RouterLink to="/login" class="btn btn-ghost btn-lg">{{ t('landing.ctaLogin') }}</RouterLink>
        </div>
      </div>

      <div class="mt-14 grid gap-4 sm:grid-cols-3">
        <div v-for="f in features" :key="f.key" class="card p-5">
          <span class="grid h-11 w-11 place-items-center rounded-xl" :class="f.bg"><Icon :name="f.icon" :size="22" /></span>
          <h3 class="mt-4 text-lg font-bold">{{ t(`landing.${f.key}Title`) }}</h3>
          <p class="mt-2 text-[15px] leading-relaxed text-ink-soft">{{ t(`landing.${f.key}Text`) }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import Logo from '@/components/ui/Logo.vue'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'

const { t } = useI18n()
const features = [
  { key: 'f1', icon: 'pen', bg: 'bg-brand-soft text-brand' },
  { key: 'f2', icon: 'scale', bg: 'bg-sky-soft text-sky-dark' },
  { key: 'f3', icon: 'chart', bg: 'bg-ok-soft text-ok-dark' }
]
</script>
