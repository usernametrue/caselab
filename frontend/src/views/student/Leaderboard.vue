<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">{{ t('leaderboard.title') }}</h1>
      <p class="mt-1 text-ink-soft">{{ t('leaderboard.lead') }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex rounded-xl border border-line bg-white p-1" role="tablist">
        <button v-for="s in scopes" :key="s" role="tab" :aria-selected="scope === s" class="rounded-lg px-3 py-1.5 text-sm font-semibold"
          :class="scope === s ? 'bg-brand-soft text-brand-dark' : 'text-ink-soft'" @click="scope = s">{{ t(`leaderboard.scopes.${s}`) }}</button>
      </div>
      <div class="flex rounded-xl border border-line bg-white p-1" role="tablist">
        <button v-for="p in periods" :key="p" role="tab" :aria-selected="period === p" class="rounded-lg px-3 py-1.5 text-sm font-semibold"
          :class="period === p ? 'bg-brand-soft text-brand-dark' : 'text-ink-soft'" @click="period = p">{{ t(`leaderboard.periods.${p}`) }}</button>
      </div>
      <select v-if="scope === 'group' && data?.groups.length > 1" v-model="groupId" class="input !w-auto" :aria-label="t('leaderboard.group')">
        <option v-for="g in data.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
    </div>

    <section class="card p-5">
      <p v-if="loading" class="text-sm text-ink-mute">{{ t('common.loading') }}</p>
      <p v-else-if="scope === 'group' && !data?.groups.length" class="text-sm text-ink-mute">{{ t('leaderboard.noGroup') }}</p>
      <p v-else-if="data?.noCourse" class="text-sm text-ink-mute">{{ t('leaderboard.noCourse') }}</p>
      <p v-else-if="!data?.rows.length" class="text-sm text-ink-mute">{{ t('leaderboard.empty') }}</p>
      <ol v-else class="divide-y divide-line">
        <li v-for="r in data.rows" :key="r.userId" class="flex items-center gap-3 py-3" :class="r.me ? 'font-bold' : ''">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-extrabold" :class="medal(r.rank)">{{ r.rank }}</span>
          <span class="min-w-0 flex-1 truncate">{{ r.fullName }} <span v-if="r.me" class="chip chip-brand ml-1">{{ t('leaderboard.you') }}</span></span>
          <span class="text-xs text-ink-mute">{{ t('dashboard.levelShort', { n: r.level }) }}</span>
          <span class="w-20 text-right font-extrabold">{{ r.xp }} XP</span>
        </li>
      </ol>
      <p v-if="data?.me && !data.rows.some((r: any) => r.me)" class="mt-3 rounded-xl bg-brand-tint p-3 text-sm">{{ t('leaderboard.yourPlace', { n: data.me.rank, xp: data.me.xp }) }}</p>
      <p v-if="scope === 'all' && data?.hidden" class="mt-3 text-sm text-ink-mute">{{ t('leaderboard.hiddenNote') }}</p>
    </section>

    <label class="flex items-center gap-3 text-sm">
      <input type="checkbox" class="h-5 w-5 accent-[var(--brand)]" :checked="hidden" @change="toggleHidden(($event.target as HTMLInputElement).checked)" />
      <span>{{ t('leaderboard.hideMe') }}</span>
    </label>
    <p class="-mt-4 text-xs text-ink-mute">{{ t('leaderboard.examNote') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiClient } from '@/plugins/axios'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/ui/toast'

const { t } = useI18n()
const auth = useAuthStore()
const scopes = ['group', 'course', 'all'] as const
const periods = ['week', 'all'] as const
const scope = ref<typeof scopes[number]>('group')
const period = ref<typeof periods[number]>('week')
const groupId = ref('')
const data = ref<any>(null)
const loading = ref(false)
const hidden = computed(() => Boolean(auth.user?.hideFromLeaderboard))

async function load() {
  loading.value = true
  try {
    const { data: d } = await apiClient.get('/leaderboard', { params: { scope: scope.value, period: period.value, groupId: groupId.value || undefined } })
    data.value = d
    if (d.groupId && !groupId.value) groupId.value = d.groupId
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}
watch([scope, period, groupId], load, { immediate: true })

const medal = (rank: number) => (rank === 1 ? 'bg-sun text-ink' : rank === 2 ? 'bg-brand-soft text-brand-dark' : rank === 3 ? 'bg-warn-soft text-warn-dark' : 'bg-paper text-ink-mute')

async function toggleHidden(value: boolean) {
  try {
    const { data: d } = await apiClient.patch('/me', { hideFromLeaderboard: value })
    auth.setUser(d.user)
    if (scope.value === 'all') load()
  } catch {
    toast(t('errors.generic'), 'bad')
  }
}
</script>
