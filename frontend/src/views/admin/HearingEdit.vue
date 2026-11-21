<template>
  <div class="flex flex-col gap-5">
    <div>
      <RouterLink v-if="!embedded" to="/admin/hearings" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('admin.hear.title') }}</RouterLink>
      <h1 class="mt-1 text-2xl font-extrabold tracking-tight">{{ isNew ? t('admin.hear.create') : form.title }}</h1>
    </div>

    <UsedBy v-if="!isNew" kind="hearing" :id="currentId" :embedded="embedded" />

    <section class="card grid gap-4 p-5 sm:grid-cols-2">
      <div class="sm:col-span-2"><label class="label" for="h-title">{{ t('admin.hear.name') }}</label><input id="h-title" v-model="form.title" class="input" /></div>
      <div><label class="label" for="h-lang">{{ t('common.language') }}</label>
        <select id="h-lang" v-model="form.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div><label class="label" for="h-status">{{ t('admin.templates.status') }}</label>
        <select id="h-status" v-model="form.status" class="input"><option v-for="st in ['draft', 'review', 'published']" :key="st" :value="st">{{ t(`admin.templates.statuses.${st}`) }}</option></select></div>
      <div><label class="label" for="h-court">{{ t('admin.hear.court') }}</label><input id="h-court" v-model="form.court" class="input" /></div>
      <div><label class="label" for="h-case-no">{{ t('admin.hear.caseNumber') }}</label><input id="h-case-no" v-model="form.caseNumber" class="input" /></div>
      <div class="sm:col-span-2"><label class="label" for="h-case">{{ t('admin.hear.caseText') }}</label><textarea id="h-case" v-model="form.caseText" class="input" rows="3" /></div>
      <div class="sm:col-span-2">
        <label class="label" for="h-hidden">{{ t('admin.hear.hiddenFacts') }}</label>
        <textarea id="h-hidden" v-model="form.hiddenFacts" class="input" rows="3" />
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.hear.hiddenFactsHint') }}</p>
      </div>
    </section>

    <section class="card grid gap-4 p-5 sm:grid-cols-2">
      <h2 class="text-lg font-bold sm:col-span-2">{{ t('admin.hear.studentRole') }}</h2>
      <div><label class="label" for="h-role">{{ t('admin.hear.roleName') }}</label><input id="h-role" v-model="form.studentRole.name" class="input" :placeholder="t('admin.hear.roleNameHint')" /></div>
      <div><label class="label" for="h-goal">{{ t('admin.hear.roleGoal') }}</label><input id="h-goal" v-model="form.studentRole.goal" class="input" /></div>
    </section>

    <section class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.hear.participants') }}</h2>
        <button v-if="form.participants.length < 8" class="btn btn-ghost" @click="addParticipant"><Icon name="plus" :size="16" /> {{ t('admin.hear.addParticipant') }}</button>
      </div>
      <p class="mt-1 text-sm text-ink-soft">{{ t('admin.hear.participantsHint') }}</p>
      <div v-for="(p, i) in form.participants" :key="i" class="mt-3 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[130px_1fr_170px_auto]">
        <input v-model.trim="p.key" class="input" :aria-label="t('admin.hear.key')" placeholder="judge" />
        <input v-model="p.name" class="input" :aria-label="t('admin.hear.participantName')" :placeholder="t('admin.hear.participantName')" />
        <select v-model="p.role" class="input" :aria-label="t('admin.hear.participantRole')">
          <option v-for="r in roles" :key="r" :value="r">{{ t(`admin.hear.roles.${r}`) }}</option>
        </select>
        <button class="btn btn-icon text-bad" :disabled="form.participants.length < 2" :aria-label="t('common.delete')" @click="form.participants.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        <textarea v-model="p.persona" class="input sm:col-span-4" rows="2" :aria-label="t('admin.hear.persona')" :placeholder="t('admin.hear.personaHint')" />
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.hear.stages') }}</h2>
        <button v-if="form.stages.length < 12" class="btn btn-ghost" @click="addStage"><Icon name="plus" :size="16" /> {{ t('admin.hear.addStage') }}</button>
      </div>
      <p class="text-sm text-ink-soft">{{ t('admin.hear.stagesHint') }}</p>
      <div v-for="(st, i) in form.stages" :key="i" class="card p-5">
        <div class="grid gap-3 sm:grid-cols-[130px_1fr_110px_auto]">
          <div><label class="label !text-xs" :for="`st-key-${i}`">{{ t('admin.hear.key') }}</label><input :id="`st-key-${i}`" v-model.trim="st.key" class="input" /></div>
          <div><label class="label !text-xs" :for="`st-title-${i}`">{{ t('admin.hear.stageTitle') }}</label><input :id="`st-title-${i}`" v-model="st.title" class="input" /></div>
          <div><label class="label !text-xs" :for="`st-max-${i}`">{{ t('admin.hear.maxTurns') }}</label><input :id="`st-max-${i}`" v-model.number="st.maxTurns" type="number" min="1" max="12" class="input" /></div>
          <div class="flex items-end gap-1">
            <button class="btn btn-icon" :disabled="i === 0" :aria-label="t('admin.hear.up')" @click="move(i, -1)"><Icon name="arrowLeft" :size="16" class="rotate-90" /></button>
            <button class="btn btn-icon text-bad" :disabled="form.stages.length < 2" :aria-label="t('common.delete')" @click="form.stages.splice(i, 1)"><Icon name="trash" :size="16" /></button>
          </div>
        </div>
        <label class="label mt-3 !text-xs" :for="`st-goal-${i}`">{{ t('admin.hear.goal') }}</label>
        <input :id="`st-goal-${i}`" v-model="st.goal" class="input" :placeholder="t('admin.hear.goalHint')" />
        <label class="label mt-3 !text-xs" :for="`st-task-${i}`">{{ t('admin.hear.studentTask') }}</label>
        <input :id="`st-task-${i}`" v-model="st.studentTask" class="input" :placeholder="t('admin.hear.studentTaskHint')" />
        <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_200px]">
          <div><label class="label !text-xs" :for="`st-open-${i}`">{{ t('admin.hear.opening') }}</label>
            <textarea :id="`st-open-${i}`" v-model="st.opening" class="input" rows="2" :placeholder="t('admin.hear.openingHint')" /></div>
          <div><label class="label !text-xs" :for="`st-by-${i}`">{{ t('admin.hear.openingBy') }}</label>
            <select :id="`st-by-${i}`" v-model="st.openingBy" class="input">
              <option value="">{{ t('admin.hear.judgeDefault') }}</option>
              <option v-for="p in form.participants.filter(x => x.key)" :key="p.key" :value="p.key">{{ p.name || p.key }}</option>
            </select></div>
        </div>
      </div>
    </section>

    <section class="card p-5">
      <h2 class="text-lg font-bold">{{ t('admin.hear.grading') }}</h2>
      <label class="label mt-3" for="h-guide">{{ t('admin.hear.decisionGuide') }}</label>
      <textarea id="h-guide" v-model="form.decisionGuide" class="input" rows="3" :placeholder="t('admin.hear.decisionGuideHint')" />
      <h3 class="mt-4 text-sm font-bold">{{ t('admin.hear.criteria') }}</h3>
      <div v-for="(c, i) in form.criteria" :key="i" class="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input v-model="c.title" class="input" :aria-label="t('admin.hear.criterionTitle')" :placeholder="t('admin.hear.criterionTitle')" />
        <input v-model="c.description" class="input" :aria-label="t('admin.hear.criterionDescription')" :placeholder="t('admin.hear.criterionDescription')" />
        <button class="btn btn-icon text-bad" :aria-label="t('common.delete')" @click="form.criteria.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button v-if="form.criteria.length < 10" class="btn btn-link mt-2" @click="form.criteria.push({ key: '', title: '', description: '' })"><Icon name="plus" :size="15" /> {{ t('admin.hear.addCriterion') }}</button>
    </section>

    <div v-if="problems.length" class="rounded-xl bg-warn-soft p-4 text-sm text-warn-dark">
      <b>{{ t('admin.scen.problems') }}</b>
      <ul class="mt-1 list-disc pl-5"><li v-for="(p, i) in problems" :key="i">{{ p }}</li></ul>
    </div>
    <p v-if="error" class="rounded-xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-dark">{{ error }}</p>
    <div class="flex flex-wrap gap-3">
      <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('common.loading') : t('common.save') }}</button>
      <button v-if="!isNew" class="btn btn-ghost text-bad" @click="remove">{{ t('common.delete') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import UsedBy from '@/components/ui/UsedBy.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

// embedded: opened in the side panel of another editor; saving reports the id instead of changing the page
const props = defineProps<{ id: string; embedded?: boolean }>()
const emit = defineEmits<{ saved: [entity: { id: string; title: string }]; deleted: [] }>()
const { t, te } = useI18n()
const router = useRouter()
const createdId = ref('')
const currentId = computed(() => createdId.value || props.id)
const isNew = computed(() => currentId.value === 'new')

const roles = ['judge', 'opponent', 'witness', 'expert', 'prosecutor', 'third_party', 'other']
interface Participant { key: string; name: string; role: string; persona: string }
interface Stage { key: string; title: string; goal: string; studentTask: string; opening: string; openingBy: string; maxTurns: number }
const form = reactive({
  title: '', language: 'ru', court: '', caseNumber: '', caseText: '', hiddenFacts: '', status: 'draft', decisionGuide: '',
  studentRole: { name: '', goal: '' },
  participants: [
    { key: 'judge', name: '', role: 'judge', persona: '' },
    { key: 'opponent', name: '', role: 'opponent', persona: '' }
  ] as Participant[],
  stages: [
    { key: 'prep', title: '', goal: '', studentTask: '', opening: '', openingBy: '', maxTurns: 3 }
  ] as Stage[],
  criteria: [] as { key: string; title: string; description: string }[]
})
const problems = ref<string[]>([])
const error = ref('')
const saving = ref(false)

onMounted(async () => {
  if (isNew.value) return
  const { data } = await apiClient.get(`/admin/hearings/${currentId.value}`)
  const h = data.hearing
  Object.assign(form, {
    title: h.title, language: h.language, court: h.court ?? '', caseNumber: h.caseNumber ?? '', caseText: h.caseText ?? '', hiddenFacts: h.hiddenFacts ?? '',
    status: h.status, decisionGuide: h.decisionGuide ?? '',
    studentRole: { name: h.studentRole?.name ?? '', goal: h.studentRole?.goal ?? '' },
    participants: (h.participants ?? []).map((p: any) => ({ persona: '', role: 'other', ...p })),
    stages: (h.stages ?? []).map((s: any) => ({ goal: '', studentTask: '', opening: '', openingBy: '', maxTurns: 4, ...s })),
    criteria: (h.criteria ?? []).map((c: any) => ({ description: '', ...c }))
  })
  problems.value = data.problems
})

function addParticipant() {
  let k = form.participants.length + 1
  while (form.participants.some(p => p.key === `p${k}`)) k++
  form.participants.push({ key: `p${k}`, name: '', role: 'other', persona: '' })
}
function addStage() {
  let k = form.stages.length + 1
  while (form.stages.some(s => s.key === `stage${k}`)) k++
  form.stages.push({ key: `stage${k}`, title: '', goal: '', studentTask: '', opening: '', openingBy: '', maxTurns: 3 })
}
function move(i: number, d: number) {
  const [st] = form.stages.splice(i, 1)
  form.stages.splice(i + d, 0, st)
}

async function save() {
  saving.value = true
  error.value = ''
  // Criteria keys follow their order: the author only writes the titles
  const body = { ...form, criteria: form.criteria.filter(c => c.title.trim()).map((c, i) => ({ ...c, key: c.key || `c${i + 1}` })) }
  try {
    const { data } = isNew.value ? await apiClient.post('/admin/hearings', body) : await apiClient.put(`/admin/hearings/${currentId.value}`, body)
    problems.value = data.problems
    toast(t('common.saved'), 'ok')
    const id = String(data.hearing._id)
    emit('saved', { id, title: data.hearing.title })
    if (isNew.value) {
      if (props.embedded) createdId.value = id
      else router.replace(`/admin/hearings/${id}`)
    }
  } catch (e: any) {
    const details = e?.response?.data?.error?.details
    if (Array.isArray(details)) problems.value = details.map((d: any) => d.message)
    const code = apiErrorCode(e)
    error.value = te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  } finally {
    saving.value = false
  }
}

async function remove() {
  const { data } = await apiClient.delete(`/admin/hearings/${currentId.value}`)
  toast(data.archived ? t('admin.scen.archived') : t('common.deleted'), 'ok')
  emit('deleted')
  if (!props.embedded) router.push('/admin/hearings')
}
</script>
