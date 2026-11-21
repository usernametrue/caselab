<template>
  <div class="flex min-h-screen items-start justify-center bg-paper px-4 pt-16">
    <form class="card w-full max-w-md p-6 sm:p-8" @submit.prevent="submit">
      <Logo />
      <h1 class="mt-6 text-2xl font-extrabold tracking-tight">{{ t('changePassword.title') }}</h1>
      <p class="mt-2 text-sm text-ink-soft">{{ t('changePassword.lead') }}</p>
      <div class="mt-6 flex flex-col gap-4">
        <div>
          <label class="label" for="cur">{{ t('changePassword.current') }}</label>
          <input id="cur" v-model="current" class="input" type="password" autocomplete="current-password" required />
        </div>
        <div>
          <label class="label" for="new">{{ t('changePassword.next') }}</label>
          <input id="new" v-model="next" class="input" type="password" autocomplete="new-password" minlength="8" required />
          <p class="mt-1.5 text-xs text-ink-mute">{{ t('auth.passwordHint') }}</p>
        </div>
      </div>
      <p v-if="error" class="mt-4 rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark" role="alert">{{ error }}</p>
      <button class="btn btn-primary mt-6 w-full" :disabled="busy || next.length < 8">{{ t('changePassword.submit') }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Logo from '@/components/ui/Logo.vue'
import { useAuthStore } from '@/stores/auth'
import { apiErrorCode } from '@/plugins/axios'

const { t, te } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const current = ref('')
const next = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await auth.changePassword(current.value, next.value)
    router.push(auth.needsOnboarding ? { name: 'Onboarding' } : auth.homeRoute)
  } catch (e) {
    const code = apiErrorCode(e)
    error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    busy.value = false
  }
}
</script>
