<template>
  <div class="flex flex-col gap-5">
    <div>
      <RouterLink v-if="!embedded" to="/admin/scenarios" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ t('admin.scen.title') }}</RouterLink>
      <h1 class="mt-1 text-2xl font-extrabold tracking-tight">{{ isNew ? t('admin.scen.create') : form.title }}</h1>
    </div>

    <UsedBy v-if="!isNew" kind="scenario" :id="scId" :embedded="embedded" />

    <section class="card grid gap-4 p-5 sm:grid-cols-2">
      <div class="sm:col-span-2"><label class="label" for="s-title">{{ t('admin.scen.name') }}</label><input id="s-title" v-model="form.title" class="input" /></div>
      <div><label class="label" for="s-lang">{{ t('common.language') }}</label>
        <select id="s-lang" v-model="form.language" class="input"><option value="ru">Русский</option><option value="uz">O'zbekcha</option></select></div>
      <div><label class="label" for="s-status">{{ t('admin.templates.status') }}</label>
        <select id="s-status" v-model="form.status" class="input"><option v-for="st in ['draft', 'review', 'published']" :key="st" :value="st">{{ t(`admin.templates.statuses.${st}`) }}</option></select></div>
      <div class="sm:col-span-2"><label class="label" for="s-case">{{ t('admin.scen.caseText') }}</label><textarea id="s-case" v-model="form.caseText" class="input" rows="3" /></div>
    </section>

    <section class="card p-5">
      <h2 class="text-lg font-bold">{{ t('admin.scen.roles') }}</h2>
      <div v-for="(r, i) in form.roles" :key="i" class="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_180px_auto]">
        <input v-model.trim="r.key" class="input" :aria-label="t('admin.scen.roleKey')" placeholder="plaintiff" />
        <input v-model="r.name" class="input" :aria-label="t('admin.scen.roleName')" :placeholder="t('admin.scen.roleName')" />
        <select v-model="r.startNodeId" class="input" :aria-label="t('admin.scen.roleStart')">
          <option value="">{{ t('admin.scen.defaultStart') }}</option>
          <option v-for="n in form.nodes" :key="n.id" :value="n.id">{{ n.id }}</option>
        </select>
        <button class="btn btn-icon text-bad" :disabled="form.roles.length < 2" :aria-label="t('common.delete')" @click="form.roles.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button v-if="form.roles.length < 4" class="btn btn-ghost mt-3" @click="form.roles.push({ key: '', name: '', startNodeId: '' })"><Icon name="plus" :size="16" /> {{ t('admin.scen.addRole') }}</button>
      <div class="mt-4 max-w-xs">
        <label class="label" for="s-start">{{ t('admin.scen.startNode') }}</label>
        <select id="s-start" v-model="form.startNodeId" class="input"><option v-for="n in form.nodes" :key="n.id" :value="n.id">{{ n.id }}</option></select>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold">{{ t('admin.scen.nodes') }}</h2>
        <button class="btn btn-ghost" @click="addNode"><Icon name="plus" :size="16" /> {{ t('admin.scen.addNode') }}</button>
      </div>
      <p class="text-sm text-ink-soft">{{ t('admin.scen.nodesHint') }}</p>
      <div v-for="(n, i) in form.nodes" :key="i" class="card p-5" :class="n.id === form.startNodeId ? 'border-brand/50' : ''">
        <div class="grid gap-3 sm:grid-cols-[160px_1fr_1fr_auto]">
          <div><label class="label !text-xs" :for="`n-id-${i}`">Id</label><input :id="`n-id-${i}`" v-model.trim="n.id" class="input" /></div>
          <div><label class="label !text-xs" :for="`n-stage-${i}`">{{ t('admin.scen.stage') }}</label><input :id="`n-stage-${i}`" v-model="n.stage" class="input" /></div>
          <div><label class="label !text-xs" :for="`n-sp-${i}`">{{ t('admin.scen.speaker') }}</label><input :id="`n-sp-${i}`" v-model="n.speaker" class="input" /></div>
          <button class="btn btn-icon self-end text-bad" :aria-label="t('common.delete')" @click="form.nodes.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <label class="label mt-3 !text-xs" :for="`n-text-${i}`">{{ t('admin.scen.text') }}</label>
        <textarea :id="`n-text-${i}`" v-model="n.text" class="input" rows="3" />
        <template v-if="n.choices.length">
          <label class="label mt-3 !text-xs" :for="`n-rub-${i}`">{{ t('admin.scen.rubric') }}</label>
          <input :id="`n-rub-${i}`" v-model="n.freeTextRubric" class="input" :placeholder="t('admin.scen.rubricHint')" />
        </template>
        <div v-else class="mt-3 max-w-xs">
          <label class="label !text-xs" :for="`n-out-${i}`">{{ t('admin.scen.outcome') }}</label>
          <select :id="`n-out-${i}`" v-model="n.outcome" class="input"><option value="">-</option><option v-for="o in ['win', 'partial', 'loss']" :key="o" :value="o">{{ t(`sim.outcome.${o}`) }}</option></select>
        </div>

        <h3 class="mt-4 text-sm font-bold">{{ t('admin.scen.choices') }}</h3>
        <div v-for="(c, ci) in n.choices" :key="ci" class="mt-2 grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[90px_1fr_150px_150px_auto]">
          <input v-model.trim="c.id" class="input" aria-label="Id" placeholder="a" />
          <input v-model="c.text" class="input" :aria-label="t('admin.scen.choiceText')" :placeholder="t('admin.scen.choiceText')" />
          <select v-model="c.next" class="input" :aria-label="t('admin.scen.next')">
            <option value="">{{ t('admin.scen.next') }}</option>
            <option v-for="x in form.nodes.filter(x => x.id !== n.id)" :key="x.id" :value="x.id">{{ x.id }}</option>
          </select>
          <select v-model="c.verdict" class="input" :aria-label="t('admin.scen.verdict')"><option v-for="v in ['correct', 'acceptable', 'wrong']" :key="v" :value="v">{{ t(`result.simVerdict.${v}`) }}</option></select>
          <button class="btn btn-icon text-bad" :aria-label="t('common.delete')" @click="n.choices.splice(ci, 1)"><Icon name="trash" :size="16" /></button>
          <input v-model="c.explanation" class="input md:col-span-3" :aria-label="t('admin.scen.explanation')" :placeholder="t('admin.scen.explanation')" />
          <input v-model="c.normRef" class="input md:col-span-2" :aria-label="t('admin.docs.normRef')" :placeholder="t('admin.docs.normRef')" />
        </div>
        <button v-if="n.choices.length < 6" class="btn btn-link mt-2" @click="n.choices.push({ id: nextChoiceId(n), text: '', next: '', verdict: 'correct', explanation: '', normRef: '' })"><Icon name="plus" :size="15" /> {{ t('admin.scen.addChoice') }}</button>
      </div>
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
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'
import UsedBy from '@/components/ui/UsedBy.vue'

// embedded: opened in the side panel of a template editor; saving reports the id instead of changing the page
const props = defineProps<{ id: string; embedded?: boolean }>()
const emit = defineEmits<{ saved: [entity: { id: string; title: string }]; deleted: [] }>()
const createdId = ref('')
const scId = computed(() => createdId.value || props.id)
const { t, te } = useI18n()
const router = useRouter()
const isNew = computed(() => scId.value === 'new')

interface Choice { id: string; text: string; next: string; verdict: string; explanation: string; normRef: string }
interface Node { id: string; stage: string; speaker: string; text: string; freeTextRubric: string; outcome: string; choices: Choice[] }
const form = reactive({
  title: '', language: 'ru', caseText: '', status: 'draft', startNodeId: 'n1',
  roles: [{ key: 'plaintiff', name: '', startNodeId: '' }] as { key: string; name: string; startNodeId: string }[],
  nodes: [
    { id: 'n1', stage: '', speaker: '', text: '', freeTextRubric: '', outcome: '', choices: [] },
    { id: 'end', stage: '', speaker: '', text: '', freeTextRubric: '', outcome: 'win', choices: [] }
  ] as Node[]
})
const problems = ref<string[]>([])
const error = ref('')
const saving = ref(false)

onMounted(async () => {
  if (isNew.value) return
  const { data } = await apiClient.get(`/admin/scenarios/${scId.value}`)
  const s = data.scenario
  Object.assign(form, {
    title: s.title, language: s.language, caseText: s.caseText ?? '', status: s.status, startNodeId: s.startNodeId,
    roles: s.roles.map((r: any) => ({ key: r.key, name: r.name, startNodeId: r.startNodeId ?? '' })),
    nodes: s.nodes.map((n: any) => ({ freeTextRubric: '', outcome: '', stage: '', speaker: '', ...n, choices: n.choices.map((c: any) => ({ explanation: '', normRef: '', next: '', ...c })) }))
  })
  problems.value = data.problems
})

function addNode() {
  let k = form.nodes.length + 1
  while (form.nodes.some(n => n.id === `n${k}`)) k++
  form.nodes.push({ id: `n${k}`, stage: '', speaker: '', text: '', freeTextRubric: '', outcome: '', choices: [] })
}
const nextChoiceId = (n: Node) => 'abcdef'.split('').find(c => !n.choices.some(x => x.id === c)) ?? String(n.choices.length + 1)

async function save() {
  saving.value = true
  error.value = ''
  // Final nodes carry an outcome, others a rubric; empty fields of the other kind are dropped
  const body = { ...form, nodes: form.nodes.map(n => (n.choices.length ? { ...n, outcome: '' } : { ...n, freeTextRubric: '' })) }
  try {
    const { data } = isNew.value ? await apiClient.post('/admin/scenarios', body) : await apiClient.put(`/admin/scenarios/${scId.value}`, body)
    problems.value = data.problems
    toast(t('common.saved'), 'ok')
    emit('saved', { id: String(data.scenario._id), title: data.scenario.title })
    if (isNew.value) {
      if (props.embedded) createdId.value = String(data.scenario._id)
      else router.replace(`/admin/scenarios/${data.scenario._id}`)
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
  const { data } = await apiClient.delete(`/admin/scenarios/${scId.value}`)
  toast(data.archived ? t('admin.scen.archived') : t('common.deleted'), 'ok')
  emit('deleted')
  if (!props.embedded) router.push('/admin/scenarios')
}
</script>
