<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-2xl font-extrabold tracking-tight">{{ t('admin.users.title') }}</h1>
      <button class="btn btn-primary" @click="creating = !creating"><Icon name="plus" :size="18" /> {{ t('admin.users.create') }}</button>
    </div>

    <form v-if="creating" class="card grid gap-4 p-5 sm:grid-cols-2" @submit.prevent="create">
      <div><label class="label" for="nu-name">{{ t('auth.fullName') }}</label><input id="nu-name" v-model.trim="form.fullName" class="input" required /></div>
      <div><label class="label" for="nu-email">{{ t('auth.email') }}</label><input id="nu-email" v-model.trim="form.email" type="email" class="input" required /></div>
      <div><label class="label" for="nu-role">{{ t('admin.users.role') }}</label>
        <select id="nu-role" v-model="form.role" class="input"><option v-for="r in roles" :key="r" :value="r">{{ t(`roles.${r}`) }}</option></select></div>
      <div><label class="label" for="nu-locale">{{ t('common.language') }}</label>
        <select id="nu-locale" v-model="form.locale" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div class="sm:col-span-2 flex gap-3"><button class="btn btn-primary">{{ t('common.save') }}</button><button type="button" class="btn btn-ghost" @click="creating = false">{{ t('common.cancel') }}</button></div>
    </form>

    <div v-if="tempPassword" class="card border-sun bg-sun-soft p-5" role="status">
      <div class="font-bold">{{ t('admin.users.tempPassword') }}</div>
      <p class="mt-1 text-sm text-ink-soft">{{ t('admin.users.tempPasswordHint', { email: tempPassword.email }) }}</p>
      <code class="mt-3 inline-block rounded-lg bg-white px-3 py-2 font-mono text-base font-bold">{{ tempPassword.value }}</code>
    </div>

    <div class="flex flex-wrap gap-2">
      <input v-model="q" class="input max-w-xs" :placeholder="t('common.search')" @keyup.enter="load" />
      <button v-for="r in ['', ...roles]" :key="r" class="filter" :class="{ 'is-active': role === r }" @click="role = r; load()">{{ r ? t(`roles.${r}`) : t('common.all') }}</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full min-w-[720px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-ink-mute">
          <tr><th class="p-3">{{ t('auth.fullName') }}</th><th class="p-3">{{ t('admin.users.role') }}</th><th class="p-3">XP</th><th class="p-3">{{ t('admin.users.state') }}</th><th class="p-3"></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" class="border-b border-line last:border-0">
            <td class="p-3"><div class="font-semibold">{{ u.fullName }}</div><div class="text-xs text-ink-mute">{{ u.email }}</div></td>
            <td class="p-3">
              <select class="input !py-1.5" :value="u.role" @change="patch(u, { role: ($event.target as HTMLSelectElement).value })">
                <option v-for="r in roles" :key="r" :value="r">{{ t(`roles.${r}`) }}</option>
              </select>
            </td>
            <td class="p-3">{{ u.xp }}</td>
            <td class="p-3">
              <span v-if="u.isBlocked" class="chip bg-bad-soft text-bad-dark">{{ t('admin.users.blocked') }}</span>
              <span v-else-if="u.mustChangePassword" class="chip chip-warn">{{ t('admin.users.mustChange') }}</span>
              <span v-else class="chip chip-ok">{{ t('admin.users.active') }}</span>
            </td>
            <td class="p-3">
              <div class="flex justify-end gap-2">
                <button class="btn btn-ghost !min-h-9 !px-3 text-sm" @click="patch(u, { isBlocked: !u.isBlocked })">{{ u.isBlocked ? t('admin.users.unblock') : t('admin.users.block') }}</button>
                <button class="btn btn-ghost !min-h-9 !px-3 text-sm" @click="reset(u)">{{ t('admin.users.reset') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const { t, te } = useI18n()
const roles = ['student', 'teacher', 'admin']
const users = ref<any[]>([])
const q = ref('')
const role = ref('')
const creating = ref(false)
const form = reactive({ fullName: '', email: '', role: 'teacher', locale: 'ru' })
const tempPassword = ref<{ email: string; value: string } | null>(null)

const fail = (e: unknown) => { const c = apiErrorCode(e); toast(te(`errors.${c}`) ? t(`errors.${c}`) : t('errors.generic'), 'bad') }

async function load() {
  const { data } = await apiClient.get('/admin/users', { params: { q: q.value || undefined, role: role.value || undefined } })
  users.value = data.users
}
async function create() {
  try {
    const { data } = await apiClient.post('/admin/users', form)
    tempPassword.value = { email: data.user.email, value: data.temporaryPassword }
    creating.value = false
    Object.assign(form, { fullName: '', email: '' })
    load()
  } catch (e) { fail(e) }
}
async function patch(u: any, body: Record<string, unknown>) {
  try {
    await apiClient.patch(`/admin/users/${u.id}`, body)
    toast(t('common.saved'), 'ok')
    load()
  } catch (e) { fail(e); load() }
}
async function reset(u: any) {
  try {
    const { data } = await apiClient.patch(`/admin/users/${u.id}`, { resetPassword: true })
    tempPassword.value = { email: u.email, value: data.temporaryPassword }
    load()
  } catch (e) { fail(e) }
}
onMounted(load)
</script>
