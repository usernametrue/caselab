<template>
  <div class="min-h-screen bg-paper lg:flex">
    <!-- SideNav (lg+) -->
    <aside class="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white px-4 py-5 lg:flex">
      <Logo to="/app" />
      <nav class="mt-8 flex flex-col gap-1">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="nav-item" :class="{ 'is-active': isActive(item.to) }">
          <Icon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
        </RouterLink>
        <RouterLink v-if="auth.user?.role === 'teacher'" to="/teacher" class="nav-item">
          <Icon name="users" />
          <span>{{ t('nav.toTeacher') }}</span>
        </RouterLink>
        <RouterLink v-if="auth.user?.role === 'admin'" to="/admin" class="nav-item">
          <Icon name="sliders" />
          <span>{{ t('nav.admin') }}</span>
        </RouterLink>
      </nav>
      <div class="mt-auto flex items-center gap-3 rounded-2xl border border-line p-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sun text-sm font-extrabold text-ink">{{ initials }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">{{ auth.user?.fullName }}</div>
          <div class="text-xs font-semibold text-ink-mute">{{ levelLine }}</div>
        </div>
        <button class="btn-icon btn" :aria-label="t('auth.signOut')" :title="t('auth.signOut')" @click="logout">
          <Icon name="logout" :size="18" />
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Header -->
      <header class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
        <div class="lg:hidden"><Logo to="/app" compact /></div>
        <div class="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <span v-if="stats.dashboard" class="chip chip-warn chip-lg" :title="t('dashboard.streak')">
            <Icon name="flame" :size="16" class="flicker" /> {{ stats.dashboard.streak.current }}
          </span>
          <span v-if="stats.dashboard" class="chip chip-brand chip-lg" title="XP">
            <Icon name="bolt" :size="16" /> {{ stats.dashboard.xp }}<span class="hidden sm:inline">&nbsp;XP</span>
          </span>
          <LanguageSwitch />
          <button class="btn-icon btn lg:hidden" :aria-label="t('auth.signOut')" @click="logout">
            <Icon name="logout" :size="18" />
          </button>
        </div>
      </header>

      <main class="mx-auto w-full max-w-content flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <GeneratingOverlay />
    <!-- BottomNav (below lg) -->
    <nav class="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white px-2 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <RouterLink v-for="item in nav" :key="item.to" :to="item.to"
        class="flex flex-1 flex-col items-center gap-1 py-2 text-xs font-semibold"
        :class="isActive(item.to) ? 'text-brand-dark' : 'text-ink-mute'">
        <Icon :name="item.icon" :size="24" />
        <span>{{ t(item.label) }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import Logo from '@/components/ui/Logo.vue'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'
import GeneratingOverlay from '@/components/ui/GeneratingOverlay.vue'
import { useAuthStore } from '@/stores/auth'
import { useStatsStore } from '@/stores/stats'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const stats = useStatsStore()

const nav = [
  { to: '/app', icon: 'home', label: 'nav.dashboard' },
  { to: '/app/train', icon: 'target', label: 'nav.train' },
  { to: '/app/progress', icon: 'chart', label: 'nav.progress' },
  { to: '/app/leaderboard', icon: 'trophy', label: 'nav.leaderboard' }
]
const isActive = (to: string) => (to === '/app' ? route.path === '/app' : route.path.startsWith(to))

const initials = computed(() => (auth.user?.fullName || '').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase())
const levelLine = computed(() => {
  const d = stats.dashboard
  if (!d) return ''
  return `${t('dashboard.levelShort', { n: d.level })} · ${d.title[locale.value as 'ru' | 'uz']}`
})

onMounted(() => { stats.refresh().catch(() => {}) })

async function logout() {
  await auth.logout()
  router.push('/login')
}
</script>
