<template>
  <div class="inline-flex rounded-lg border p-0.5" :class="dark ? 'border-white/20' : 'border-line bg-white'" role="group" :aria-label="t('common.language')">
    <button v-for="l in availableLocales" :key="l.code" type="button"
      class="rounded-md px-2.5 py-1 text-xs font-bold transition-colors"
      :class="locale === l.code ? (dark ? 'bg-white/15 text-white' : 'bg-brand-soft text-brand-dark') : (dark ? 'text-white/70 hover:text-white' : 'text-ink-mute hover:text-ink')"
      :aria-pressed="locale === l.code" @click="choose(l.code)">
      {{ l.short }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { availableLocales, changeLocale } from '@/utils/i18n'
import { useAuthStore } from '@/stores/auth'

withDefaults(defineProps<{ dark?: boolean }>(), { dark: false })
const { t, locale } = useI18n()
const auth = useAuthStore()

async function choose(code: string) {
  await changeLocale(code)
  // The profile language also decides the language of generated tasks and feedback
  if (auth.user && auth.user.locale !== code) await auth.update({ locale: code }).catch(() => {})
}
</script>
