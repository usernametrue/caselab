<template>
  <div class="flex min-h-screen flex-col bg-paper">
    <header class="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6">
      <Logo />
      <LanguageSwitch />
    </header>
    <main class="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
      <form class="card w-full max-w-md p-6 sm:p-8 animate-rise" novalidate @submit.prevent="submit">
        <span class="eyebrow">CaseLab</span>
        <h1 class="mt-2 text-2xl font-extrabold tracking-tight">{{ mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle') }}</h1>

        <div class="mt-6 flex flex-col gap-4">
          <div v-if="mode === 'register'">
            <label class="label" for="fullName">{{ t('auth.fullName') }}</label>
            <input id="fullName" v-model.trim="form.fullName" class="input" autocomplete="name" required :placeholder="t('auth.fullNamePlaceholder')" />
          </div>
          <div>
            <label class="label" for="email">{{ t('auth.email') }}</label>
            <input id="email" v-model.trim="form.email" class="input" type="email" autocomplete="email" required placeholder="name@university.uz" />
          </div>
          <div>
            <label class="label" for="password">{{ t('auth.password') }}</label>
            <input id="password" v-model="form.password" class="input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required />
            <p v-if="mode === 'register'" class="mt-1.5 text-xs text-ink-mute">{{ t('auth.passwordHint') }}</p>
          </div>
          <template v-if="mode === 'register'">
            <div>
              <label class="label" for="course">{{ t('auth.course') }}</label>
              <select id="course" v-model.number="form.course" class="input">
                <option v-for="c in 6" :key="c" :value="c">{{ t('auth.courseN', { n: c }) }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="invite">{{ t('auth.inviteCode') }}</label>
              <input id="invite" v-model.trim="form.inviteCode" class="input uppercase placeholder:normal-case" :placeholder="t('auth.inviteHint')" />
            </div>
          </template>
        </div>

        <p v-if="error" class="mt-4 rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark" role="alert">{{ error }}</p>

        <button class="btn btn-primary mt-6 w-full" type="submit" :disabled="busy">
          {{ busy ? t('common.loading') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister') }}
        </button>
        <p class="mt-4 text-center text-sm text-ink-soft">
          <template v-if="mode === 'login'">{{ t('auth.noAccount') }} <RouterLink to="/register" class="font-semibold text-brand">{{ t('auth.register') }}</RouterLink></template>
          <template v-else>{{ t('auth.haveAccount') }} <RouterLink to="/login" class="font-semibold text-brand">{{ t('auth.signIn') }}</RouterLink></template>
        </p>
      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Logo from '@/components/ui/Logo.vue'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'
import { useAuthStore } from '@/stores/auth'
import { apiErrorCode } from '@/plugins/axios'

const props = defineProps<{ mode: 'login' | 'register' }>()
const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const form = reactive({ fullName: '', email: '', password: '', course: 1, inviteCode: '' })
const busy = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!form.email || !form.password || (props.mode === 'register' && (!form.fullName || form.password.length < 8))) {
    error.value = t('errors.fillForm')
    return
  }
  busy.value = true
  try {
    if (props.mode === 'login') await auth.login(form.email, form.password)
    else await auth.register({ ...form, locale: locale.value })
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : null
    router.push(redirect ?? auth.homeRoute)
  } catch (e) {
    const code = apiErrorCode(e)
    error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    busy.value = false
  }
}
</script>
