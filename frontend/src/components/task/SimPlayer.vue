<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="card p-6 text-sm text-ink-mute">{{ t('common.loading') }}</div>

    <!-- Role choice when the task does not set it (PRD 4.6) -->
    <div v-else-if="state && !state.role" class="card p-5">
      <span class="eyebrow">{{ t('sim.chooseRole') }}</span>
      <p class="mt-2 text-sm text-ink-mute">{{ t('sim.chooseRoleHint') }}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button v-for="r in state.roles" :key="r.key" class="btn btn-ghost" :disabled="busy" @click="chooseRole(r.key)">{{ r.name }}</button>
      </div>
    </div>

    <template v-else-if="state">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip chip-brand"><Icon name="user" :size="13" /> {{ state.roleName }}</span>
        <span class="text-xs font-semibold text-ink-mute">{{ t('sim.moves', { n: state.history.length }) }}</span>
      </div>

      <!-- The path so far -->
      <ol v-if="state.history.length" class="flex flex-col gap-3">
        <li v-for="(h, i) in state.history" :key="i" class="card p-4">
          <div class="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-mute">
            <span v-if="h.stage" class="chip chip-outline">{{ h.stage }}</span>
            <span>{{ h.speaker }}</span>
          </div>
          <p class="mt-2 text-sm text-ink-soft">{{ h.text }}</p>
          <p class="mt-2 rounded-xl bg-brand-tint px-3 py-2 text-sm"><b>{{ t('sim.yourMove') }}:</b> {{ h.choice }}</p>
          <p v-if="h.justification" class="mt-1 text-sm text-ink-soft"><b>{{ t('sim.justification') }}:</b> {{ h.justification }}</p>
        </li>
      </ol>

      <!-- Current node -->
      <div v-if="state.node" class="card p-5" :class="state.finished ? (state.node.outcome === 'win' ? 'border-ok/40 bg-ok-soft' : state.node.outcome === 'loss' ? 'border-bad/30 bg-bad-soft' : 'border-warn/40 bg-warn-soft') : 'border-brand/40'">
        <div class="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-mute">
          <span v-if="state.node.stage" class="chip chip-outline">{{ state.node.stage }}</span>
          <span>{{ state.node.speaker }}</span>
        </div>
        <p class="doc-text mt-3">{{ state.node.text }}</p>
        <template v-if="state.finished">
          <p class="mt-3 font-bold">{{ t(`sim.outcome.${state.node.outcome || 'partial'}`) }}</p>
          <p v-if="!readonly" class="mt-1 text-sm text-ink-soft">{{ t('sim.finishedHint') }}</p>
        </template>
        <template v-else-if="!readonly">
          <div class="mt-4 flex flex-col gap-2">
            <button v-for="c in state.node.choices" :key="c.id" type="button" class="rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors"
              :class="picked === c.id ? 'border-brand bg-brand-tint text-brand-dark' : 'border-line bg-white hover:border-brand/40'" @click="picked = c.id">
              {{ c.text }}
            </button>
          </div>
          <div v-if="state.node.needsJustification" class="mt-4">
            <label class="label" for="sim-just">{{ t('sim.justificationLabel') }}</label>
            <textarea id="sim-just" v-model="justification" class="input" rows="3" :placeholder="t('sim.justificationHint')" />
          </div>
          <div class="mt-4 flex justify-end">
            <button class="btn btn-primary" :disabled="!picked || busy || (state.node.needsJustification && justification.trim().length < 10)" @click="move">
              {{ busy ? t('common.loading') : t('sim.makeMove') }}
            </button>
          </div>
        </template>
      </div>
      <p v-if="error" class="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ error }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'

const props = withDefaults(defineProps<{ instanceId: string; readonly?: boolean }>(), { readonly: false })
const emit = defineEmits<{ finished: [value: boolean] }>()
const { t, te } = useI18n()

const state = ref<any>(null)
const loading = ref(true)
const busy = ref(false)
const picked = ref('')
const justification = ref('')
const error = ref('')

const apply = (s: any) => {
  state.value = s
  picked.value = ''
  justification.value = ''
  emit('finished', Boolean(s?.finished))
}
const fail = (e: unknown) => {
  const code = apiErrorCode(e)
  error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
}

onMounted(async () => {
  try {
    const { data } = await apiClient.get(`/sim/${props.instanceId}`)
    apply(data.state)
  } catch (e) { fail(e) } finally { loading.value = false }
})

async function chooseRole(role: string) {
  busy.value = true
  error.value = ''
  try {
    const { data } = await apiClient.post(`/sim/${props.instanceId}/role`, { role })
    apply(data.state)
  } catch (e) { fail(e) } finally { busy.value = false }
}

async function move() {
  busy.value = true
  error.value = ''
  try {
    const { data } = await apiClient.post(`/sim/${props.instanceId}/turn`, { choiceId: picked.value, justification: justification.value.trim() })
    apply(data.state)
  } catch (e) { fail(e) } finally { busy.value = false }
}
</script>
