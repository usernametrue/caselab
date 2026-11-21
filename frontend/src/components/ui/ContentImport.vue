<template>
  <div class="contents">
    <label class="btn btn-ghost cursor-pointer"><Icon name="file" :size="18" /> {{ busy && !report ? t('common.loading') : t('admin.templates.importJson') }}
      <input type="file" accept=".json,application/json" class="sr-only" :disabled="busy" @change="pick" /></label>
    <Teleport v-if="report" :to="target">
      <!-- ADM-8: the check of the whole file first, then the write on confirmation -->
      <div class="card p-5 text-sm" role="status">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="text-base font-bold">{{ report.dryRun ? t('pack.checkTitle', { name: fileName }) : t('pack.doneTitle') }}</h2>
            <p class="mt-1 text-ink-mute">{{ report.dryRun ? t('pack.checkLead') : t('pack.doneLead') }}</p>
          </div>
          <button type="button" class="btn-icon btn shrink-0" :aria-label="t('common.cancel')" @click="close"><Icon name="x" :size="16" /></button>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-4">
          <div v-for="k in kinds.filter(x => x !== 'bodies' || report.created.bodies)" :key="k" class="rounded-xl bg-paper p-3">
            <div class="text-xs font-semibold text-ink-mute">{{ t(`pack.kinds.${k}`) }}</div>
            <div class="mt-1"><b class="text-ok-dark">+{{ report.created[k] }}</b> <span class="text-ink-mute">{{ t('pack.new') }}</span> · <b class="text-brand-dark">{{ report.updated[k] }}</b> <span class="text-ink-mute">{{ report.dryRun ? t('pack.updated') : t('pack.updatedDone') }}</span></div>
          </div>
        </div>
        <div v-if="report.errors.length" class="mt-3 rounded-xl bg-bad-soft p-3 text-bad-dark">
          <div class="font-bold">{{ t('pack.errors', { n: report.errors.length }) }}</div>
          <ul class="mt-1 list-disc pl-5"><li v-for="(e, i) in report.errors" :key="i"><b>{{ t(`pack.kind.${e.kind}`) }} #{{ e.index + 1 }}<template v-if="e.key"> ({{ e.key }})</template></b> {{ e.title }}: {{ e.message }}</li></ul>
        </div>
        <div v-if="report.warnings.length" class="mt-3 rounded-xl bg-warn-soft p-3 text-warn-dark">
          <div class="font-bold">{{ t('pack.warnings') }}</div>
          <ul class="mt-1 list-disc pl-5"><li v-for="(e, i) in report.warnings" :key="i"><b>{{ t(`pack.kind.${e.kind}`) }} #{{ e.index + 1 }}</b> {{ e.title }}: {{ e.message }}</li></ul>
        </div>
        <div v-if="report.dryRun" class="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-primary" :disabled="busy || !report.items.length" @click="apply">{{ busy ? t('common.loading') : t('pack.apply', { n: report.items.length }) }}</button>
          <button type="button" class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
          <span v-if="report.errors.length && report.items.length" class="text-xs text-ink-mute">{{ t('pack.partial') }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

// endpoint: /admin/import or /teacher/content/import; target: where the report card is shown
const props = defineProps<{ endpoint: string; target: string }>()
const emit = defineEmits<{ done: [] }>()
const { t, te } = useI18n()
const kinds = ['documents', 'scenarios', 'templates', 'tracks', 'bodies'] as const

const busy = ref(false)
const report = ref<any>(null)
const fileName = ref('')
let body: unknown = null

async function send(dryRun: boolean) {
  const res = await apiClient.post(props.endpoint, body, { params: dryRun ? { dryRun: 1 } : {}, timeout: 120000, validateStatus: s => s === 200 || s === 201 || s === 400 })
  if (!res.data?.created) throw Object.assign(new Error('bad'), { response: res })
  return res.data
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  report.value = null
  try {
    fileName.value = file.name
    body = JSON.parse(await file.text())
    report.value = await send(true)
  } catch (err) {
    const code = err instanceof SyntaxError ? 'bad_json' : apiErrorCode(err)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    busy.value = false
  }
}

async function apply() {
  busy.value = true
  try {
    report.value = await send(false)
    toast(t('pack.doneTitle'), report.value.errors.length ? 'info' : 'ok')
    emit('done')
  } catch (err) {
    const code = apiErrorCode(err)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    busy.value = false
  }
}

function close() {
  report.value = null
  body = null
}
</script>
