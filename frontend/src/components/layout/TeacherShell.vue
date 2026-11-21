<template>
  <div class="min-h-screen bg-paper lg:flex">
    <aside class="nav-dark sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink px-4 py-5 text-white lg:flex">
      <Logo to="/teacher" light />
      <div class="mt-6 text-xs font-semibold uppercase tracking-[.14em] text-white/70">{{ t('teacher.cabinet') }}</div>
      <nav class="mt-3 flex flex-col gap-1">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="nav-item" :class="{ 'is-active': isActive(item.to) }">
          <Icon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
        </RouterLink>
        <RouterLink to="/app/train" class="nav-item">
          <Icon name="target" />
          <span>{{ t('teacher.nav.preview') }}</span>
        </RouterLink>
      </nav>
      <div class="mt-auto">
        <div class="truncate text-sm font-semibold">{{ auth.user?.fullName }}</div>
        <div class="truncate text-xs text-white/70">{{ auth.user?.email }}</div>
        <div class="mt-3 flex items-center gap-2">
          <button class="btn btn-on-dark flex-1" @click="logout"><Icon name="logout" :size="18" /> {{ t('auth.signOut') }}</button>
          <LanguageSwitch dark />
        </div>
      </div>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-30 border-b border-line bg-ink px-4 text-white lg:hidden">
        <div class="flex h-14 items-center justify-between">
          <Logo to="/teacher" light compact />
          <div class="flex items-center gap-2">
            <LanguageSwitch dark />
            <button class="btn-icon btn text-white" :aria-label="t('auth.signOut')" @click="logout"><Icon name="logout" :size="18" /></button>
          </div>
        </div>
        <nav class="nav-dark -mx-1 flex gap-1 overflow-x-auto pb-2">
          <RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="nav-item whitespace-nowrap !py-1.5 text-sm" :class="{ 'is-active': isActive(item.to) }">{{ t(item.label) }}</RouterLink>
        </nav>
      </header>
      <main class="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6">
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import Logo from '@/components/ui/Logo.vue'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const nav = [
  { to: '/teacher', icon: 'users', label: 'teacher.nav.groups' },
  { to: '/teacher/assignments', icon: 'calendar', label: 'teacher.nav.assignments' },
  { to: '/teacher/content', icon: 'file', label: 'teacher.nav.content' },
  { to: '/teacher/moderation', icon: 'shield', label: 'teacher.nav.moderation' }
]
const isActive = (to: string) => (to === '/teacher' ? route.path === '/teacher' || route.path.startsWith('/teacher/groups')
  : to === '/teacher/content' ? ['/teacher/content', '/teacher/templates', '/teacher/documents'].some(p => route.path.startsWith(p))
  : route.path.startsWith(to))
async function logout() {
  await auth.logout()
  router.push('/login')
}
</script>
