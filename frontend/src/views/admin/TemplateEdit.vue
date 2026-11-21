<template>
  <form class="flex flex-col gap-5" @submit.prevent="save">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <RouterLink v-if="!embedded" :to="listPath" class="btn btn-link -ml-2"><Icon name="arrowLeft" :size="16" /> {{ teacherMode ? t('teacher.nav.content') : t('admin.nav.templates') }}</RouterLink>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ isNew ? t('admin.templates.create') : t('admin.templates.edit') }}</h1>
      </div>
      <div class="flex gap-2">
        <button v-if="!isNew" type="button" class="btn btn-ghost" @click="exportJson"><Icon name="file" :size="16" /> JSON</button>
        <button v-if="!isNew" type="button" class="btn btn-ghost" @click="remove">{{ t('common.delete') }}</button>
        <button class="btn btn-primary" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </div>

    <div v-if="errors.length" class="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad-dark" role="alert">
      <div class="font-bold">{{ t('admin.templates.fixErrors') }}</div>
      <ul class="mt-1 list-disc pl-5"><li v-for="(e, i) in errors" :key="i">{{ e }}</li></ul>
    </div>

    <UsedBy v-if="!isNew && !teacherMode" kind="template" :id="tplId" :embedded="embedded" />

    <!-- Basics -->
    <section class="card grid gap-4 p-5 sm:grid-cols-3">
      <div><label class="label" for="tt">{{ t('admin.templates.taskType') }}</label>
        <select id="tt" v-model="f.taskType" class="input"><option v-for="tt in taskTypes" :key="tt" :value="tt">{{ t(`taskTypes.${tt}`) }}</option></select></div>
      <div><label class="label" for="dif">{{ t('admin.templates.difficulty') }}</label>
        <select id="dif" v-model.number="f.difficulty" class="input"><option v-for="n in 5" :key="n" :value="n">{{ n }}</option></select>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.difficultyHint') }}</p></div>
      <div><label class="label" for="st">{{ t('admin.templates.status') }}</label>
        <select id="st" v-model="f.status" class="input"><option v-for="s in statuses" :key="s" :value="s">{{ t(`admin.templates.statuses.${s}`) }}</option></select>
        <p v-if="teacherMode" class="mt-1 text-xs text-ink-mute">{{ t('teacher.content.statusHint') }}</p></div>
      <div class="sm:col-span-3">
        <div class="label">{{ t('admin.templates.skills') }}</div>
        <div v-for="(s, i) in f.skills" :key="i" class="mb-2 flex gap-2">
          <select v-model="s.key" class="input" :aria-label="t('admin.templates.skills')">
            <option value="" disabled>-</option>
            <option v-for="sk in skillOptions" :key="sk.key" :value="sk.key">{{ sk.key }} - {{ sk.name[lang] || sk.name.ru }}</option>
          </select>
          <input v-model.number="s.weight" type="number" min="0" max="1" step="0.1" class="input !w-24" :aria-label="t('admin.templates.weight')" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.skills.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button v-if="f.skills.length < 3" type="button" class="btn btn-ghost" @click="f.skills.push({ key: '', weight: 1 })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addSkill') }}</button>
      </div>
    </section>

    <!-- Texts in both languages -->
    <section class="card flex flex-col gap-4 p-5">
      <h2 class="font-bold">{{ t('admin.templates.texts') }}</h2>
      <p class="-mt-2 text-xs text-ink-mute">{{ t('admin.templates.textsHint') }}</p>
      <LocalizedField v-model="f.title" :label="t('admin.templates.fTitle')" />
      <LocalizedField v-model="f.instructions" :label="t('admin.templates.fInstructions')" multiline :rows="2" />
      <LocalizedField v-model="f.context.role" :label="t('admin.templates.fRole')" />
      <div class="max-w-xs"><label class="label" for="today">{{ t('admin.templates.fToday') }}</label><input id="today" v-model="f.context.today" type="date" class="input" />
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.fTodayHint') }}</p></div>
      <LocalizedField v-model="f.caseText" :label="t('admin.templates.fCase')" multiline :rows="7" />
      <LocalizedField v-if="f.taskType === 'draft_part'" v-model="f.lockedDocument" :label="t('admin.templates.fLocked')" multiline :rows="8" />
      <LocalizedField v-if="!isReview" v-model="f.referenceAnswer" :label="isProcess || isRoute ? t('admin.templates.fReferenceProcess') : t('admin.templates.fReference')" multiline :rows="isProcess || isRoute ? 4 : 8" />
      <label v-if="!isReview && !isSim && !isHearing" class="flex items-center gap-2 text-sm"><input v-model="f.aiRewrite" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.templates.aiRewrite') }}</label>
    </section>

    <!-- Review trainers: document and client side -->
    <section v-if="isReview" class="card grid gap-4 p-5 sm:grid-cols-2">
      <h2 class="font-bold sm:col-span-2">{{ t('admin.templates.reviewTitle') }}</h2>
      <p class="-mt-2 text-xs text-ink-mute sm:col-span-2">{{ t('admin.templates.reviewHint') }}</p>
      <div><label class="label" for="rv-doc">{{ t('admin.templates.document') }}</label>
        <EntityPicker v-model="f.review.documentId" kind="document" input-id="rv-doc" :editable="!teacherMode" @changed="reloadLinks"
          :options="docOptions.map((doc: any) => ({ id: doc._id, label: `${doc.title} (${t(`admin.templates.statuses.${doc.status}`)}, ${t('admin.docs.counts', { f: doc.flawsCount, e: doc.editsCount })})` }))" /></div>
      <div v-if="needsSide"><label class="label" for="rv-side">{{ t('admin.templates.clientSide') }}</label>
        <select id="rv-side" v-model="f.review.clientSide" class="input">
          <option value="" disabled>-</option>
          <option v-for="p in selectedDoc?.parties ?? []" :key="p.key" :value="p.key">{{ p.name[lang] || p.name.ru || p.key }}</option>
        </select></div>
      <div v-if="f.taskType === 'mines'"><label class="label" for="rv-timer">{{ t('admin.templates.timer') }}</label>
        <input id="rv-timer" v-model.number="timerMin" type="number" min="0" max="120" class="input" />
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.timerHint') }}</p></div>
      <LocalizedField v-if="needsSide" v-model="f.review.clientGoals" class="sm:col-span-2" :label="t('admin.templates.clientGoals')" multiline :rows="2" />
    </section>

    <!-- Extraction of terms (PRD 4.8): the package, the terms and the reference value of every term in every document -->
    <template v-if="isExtraction">
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.exDocsTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.exDocsHint') }}</p>
        <div v-for="(_, i) in f.extraction.documentIds" :key="i" class="mt-3 flex gap-2">
          <EntityPicker v-model="f.extraction.documentIds[i]" class="min-w-0 flex-1" kind="document" :editable="!teacherMode" @changed="reloadLinks"
            :options="documents.map((doc: any) => ({ id: doc._id, label: `${doc.title} (${t(`admin.templates.statuses.${doc.status}`)})` }))" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.extraction.documentIds.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button v-if="f.extraction.documentIds.length < 5" type="button" class="btn btn-ghost mt-3" @click="f.extraction.documentIds.push('')"><Icon name="plus" :size="16" /> {{ t('admin.templates.exAddDoc') }}</button>
      </section>
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.exFieldsTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.exFieldsHint') }}</p>
        <div v-for="(fl, i) in f.extraction.fields" :key="i" class="mt-3 rounded-xl border border-line p-3">
          <div class="flex flex-wrap items-center gap-3">
            <input v-model.trim="fl.key" class="input !w-44" placeholder="penalty" :aria-label="t('admin.templates.exFieldKey')" />
            <select v-model="fl.kind" class="input !w-auto" :aria-label="t('admin.templates.varKind')">
              <option v-for="k in ['text', 'date', 'money', 'bool']" :key="k" :value="k">{{ t(`admin.templates.exKinds.${k}`) }}</option>
            </select>
            <button type="button" class="btn btn-icon ml-auto text-bad" :aria-label="t('common.delete')" @click="f.extraction.fields.splice(i, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <LocalizedField v-model="fl.label" class="mt-2" :label="t('admin.templates.exFieldLabel')" />
          <LocalizedField v-model="fl.hint" class="mt-2" :label="t('admin.templates.exFieldHint')" />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button v-if="f.extraction.fields.length < 15" type="button" class="btn btn-ghost" @click="f.extraction.fields.push({ key: '', label: L(), kind: 'text', hint: L() })"><Icon name="plus" :size="16" /> {{ t('admin.templates.exAddField') }}</button>
          <button v-if="!f.extraction.fields.length" type="button" class="btn btn-ghost" @click="addPresetFields"><Icon name="list" :size="16" /> {{ t('admin.templates.exPreset') }}</button>
        </div>
      </section>
      <section v-if="exDocs.length && exFields.length" class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.exRefTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.exRefHint') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button v-for="d in exDocs" :key="d._id" type="button" class="filter" :class="{ 'is-active': exActiveDoc === d._id }" @click="exActiveDoc = d._id">{{ d.title }}</button>
        </div>
        <template v-for="fl in exFields" :key="fl.key">
        <div v-if="refCell(fl.key)" class="mt-3 grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[200px_1fr]">
          <div class="text-sm font-semibold">{{ fl.label[lang] || fl.label.ru || fl.key }}<div class="text-xs font-normal text-ink-mute">{{ t(`admin.templates.exKinds.${fl.kind}`) }}</div></div>
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-3">
              <select v-if="fl.kind === 'bool'" v-model="refCell(fl.key).value" class="input !w-auto" :disabled="refCell(fl.key).absent" :aria-label="t('admin.templates.exValue')">
                <option value="">-</option><option value="yes">{{ t('extraction.yes') }}</option><option value="no">{{ t('extraction.no') }}</option>
              </select>
              <input v-else-if="fl.kind === 'date'" v-model="refCell(fl.key).value" type="date" class="input !w-auto" :disabled="refCell(fl.key).absent" :aria-label="t('admin.templates.exValue')" />
              <input v-else v-model="refCell(fl.key).value" class="input min-w-0 flex-1" :inputmode="fl.kind === 'money' ? 'numeric' : undefined" :disabled="refCell(fl.key).absent" :placeholder="fl.kind === 'money' ? '150000000' : ''" :aria-label="t('admin.templates.exValue')" />
              <label class="flex items-center gap-2 text-sm"><input v-model="refCell(fl.key).absent" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('extraction.absent') }}</label>
            </div>
            <textarea v-if="!refCell(fl.key).absent" v-model="refCell(fl.key).quote" class="input text-sm" rows="2" :placeholder="t('admin.templates.exQuoteHint')" :aria-label="t('admin.templates.exQuote')" />
          </div>
        </div>
        </template>
      </section>
    </template>

    <!-- "Where to apply": the client's facts and the accepted routes (PRD 4.5) -->
    <template v-if="isRoute">
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.factsTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.factsHint') }}</p>
        <div v-for="(fact, i) in f.route.clientFacts" :key="i" class="mt-3 rounded-xl border border-line p-3">
          <div class="flex flex-wrap items-center gap-3">
            <input v-model.trim="fact.key" class="input !w-40" placeholder="receipt" :aria-label="t('admin.templates.factKey')" />
            <label class="flex items-center gap-2 text-sm"><input v-model="fact.onRequest" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.templates.onRequest') }}</label>
            <button type="button" class="btn btn-icon ml-auto text-bad" :aria-label="t('common.delete')" @click="f.route.clientFacts.splice(i, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <LocalizedField v-model="fact.text" class="mt-2" :label="t('admin.templates.factText')" />
        </div>
        <button type="button" class="btn btn-ghost mt-3" @click="f.route.clientFacts.push({ key: `fact${f.route.clientFacts.length + 1}`, text: L(), onRequest: false })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addFact') }}</button>
      </section>
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.routesTitle') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.routesHint') }}</p>
        <div v-for="(r, ri) in f.route.acceptableRoutes" :key="ri" class="mt-3 rounded-xl border border-line p-4">
          <div class="flex flex-wrap items-center gap-3">
            <select v-model.number="r.score" class="input !w-auto" :aria-label="t('admin.templates.routeScore')">
              <option :value="100">{{ t('result.routeBest') }} (100)</option><option :value="70">{{ t('result.routeAcceptable') }} (70)</option>
            </select>
            <button type="button" class="btn btn-icon ml-auto text-bad" :aria-label="t('common.delete')" @click="f.route.acceptableRoutes.splice(ri, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <div v-for="(st, si) in r.steps" :key="si" class="mt-3 grid gap-2 rounded-lg bg-paper p-3 md:grid-cols-[1fr_1fr_auto]">
            <BodyPicker :id="`tr-${ri}-${si}`" :model-value="st.bodyCode ? { code: st.bodyCode, name: bodyNameMap[st.bodyCode] || st.bodyCode } : null"
              @update:model-value="(v: any) => { st.bodyCode = v?.code ?? ''; if (v) bodyNameMap[v.code] = v.name }" />
            <input v-model="st.basis" class="input" :placeholder="t('route.basisHint')" :aria-label="t('route.basis')" />
            <button type="button" class="btn btn-icon text-bad" :aria-label="t('common.delete')" @click="r.steps.splice(si, 1)"><Icon name="trash" :size="16" /></button>
            <LocalizedField v-model="st.deadline" class="md:col-span-2" :label="t('route.deadline')" />
            <label class="flex items-center gap-2 self-end text-sm"><input v-model="st.pretrial" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('result.pretrial') }}</label>
          </div>
          <button type="button" class="btn btn-link mt-2" @click="r.steps.push({ bodyCode: '', basis: '', deadline: L(), pretrial: false })"><Icon name="plus" :size="15" /> {{ t('route.addStep') }}</button>
          <LocalizedField v-model="r.comment" class="mt-2" :label="t('admin.templates.routeComment')" />
        </div>
        <button type="button" class="btn btn-ghost mt-3" @click="f.route.acceptableRoutes.push({ score: f.route.acceptableRoutes.length ? 70 : 100, comment: L(), steps: [{ bodyCode: '', basis: '', deadline: L(), pretrial: false }] })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addRoute') }}</button>
      </section>
    </template>

    <!-- Simulation: the scenario and the role -->
    <section v-if="isSim" class="card grid gap-4 p-5 sm:grid-cols-2">
      <h2 class="font-bold sm:col-span-2">{{ t('admin.templates.simTitle') }}</h2>
      <div><label class="label" for="sm-sc">{{ t('admin.templates.scenario') }}</label>
        <EntityPicker v-model="f.sim.scenarioId" kind="scenario" input-id="sm-sc" :editable="!teacherMode" @changed="reloadLinks"
          :options="scenarios.map((sc: any) => ({ id: sc._id, label: `${sc.title} (${t(`admin.templates.statuses.${sc.status}`)})` }))" /></div>
      <div><label class="label" for="sm-role">{{ t('admin.templates.simRole') }}</label>
        <select id="sm-role" v-model="f.sim.role" class="input"><option value="">{{ t('admin.templates.simRoleFree') }}</option>
          <option v-for="r in selectedScenario?.roles ?? []" :key="r.key" :value="r.key">{{ r.name }}</option></select></div>
    </section>

    <!-- Hearing with AI participants: the scenario of stages and participants -->
    <section v-if="isHearing" class="card grid gap-4 p-5 sm:grid-cols-2">
      <h2 class="font-bold sm:col-span-2">{{ t('admin.templates.hearingTitle') }}</h2>
      <p class="-mt-2 text-xs text-ink-mute sm:col-span-2">{{ t('admin.templates.hearingHint') }}</p>
      <div class="sm:col-span-2"><label class="label" for="hr-sc">{{ t('admin.templates.hearingScenario') }}</label>
        <EntityPicker v-model="f.hearing.scenarioId" kind="hearing" input-id="hr-sc" @changed="reloadLinks"
          :options="hearings.map((h: any) => ({ id: h._id, label: `${h.title} (${t(`admin.templates.statuses.${h.status}`)})` }))" /></div>
    </section>

    <!-- proc_draft: the document the situation requires (PRD 4.4) -->
    <section v-if="f.taskType === 'proc_draft'" class="card flex flex-col gap-4 p-5">
      <h2 class="font-bold">{{ t('admin.templates.procDraftTitle') }}</h2>
      <LocalizedField v-model="f.process.draftDocType" :label="t('admin.templates.draftDocType')" />
      <LocalizedField v-model="f.process.instructionsHidden" :label="t('admin.templates.instructionsHidden')" multiline :rows="2" />
      <p class="-mt-2 text-xs text-ink-mute">{{ t('admin.templates.instructionsHiddenHint') }}</p>
    </section>

    <!-- proc_timeline: the case package and the deadlines the engine checks -->
    <template v-if="f.taskType === 'proc_timeline'">
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.timelineEvents') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.timelineEventsHint') }}</p>
        <div v-for="(e, i) in f.process.timeline.events" :key="i" class="mt-3 rounded-xl border border-line p-3">
          <div class="grid gap-2 md:grid-cols-[140px_1fr_160px_160px_auto]">
            <input v-model.trim="e.key" class="input" placeholder="decision" :aria-label="t('admin.templates.eventKey')" />
            <LocalizedField v-model="e.title" :label="t('admin.templates.fTitle')" />
            <div><label class="label !text-xs" :for="`ev-d-${i}`">{{ t('admin.templates.eventDate') }}</label><input :id="`ev-d-${i}`" v-model="e.date" type="date" class="input" :disabled="Boolean(e.dateVar)" /></div>
            <div><label class="label !text-xs" :for="`ev-v-${i}`">{{ t('admin.templates.dateVar') }}</label>
              <select :id="`ev-v-${i}`" v-model="e.dateVar" class="input"><option value="">-</option><option v-for="v in dateVars" :key="v" :value="v">{{ v }}</option></select></div>
            <button type="button" class="btn-icon btn self-end text-bad" :aria-label="t('common.delete')" @click="f.process.timeline.events.splice(i, 1)"><Icon name="trash" :size="16" /></button>
          </div>
          <LocalizedField v-model="e.text" class="mt-2" :label="t('admin.docs.text')" multiline :rows="2" />
        </div>
        <button type="button" class="btn btn-ghost mt-3" @click="f.process.timeline.events.push({ key: `e${f.process.timeline.events.length + 1}`, title: L(), date: '', dateVar: '', text: L() })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addEvent') }}</button>
      </section>
      <section class="card p-5">
        <h2 class="font-bold">{{ t('admin.templates.timelineChecks') }}</h2>
        <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.timelineChecksHint') }}</p>
        <div v-for="(c, i) in f.process.timeline.checks" :key="i" class="mt-3 grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[1fr_1fr_1fr_120px_auto]">
          <LocalizedField v-model="c.label" class="md:col-span-5" :label="t('timeline.label')" />
          <select v-model="c.fromEventKey" class="input" :aria-label="t('timeline.from')"><option value="" disabled>{{ t('timeline.from') }}</option><option v-for="e in f.process.timeline.events" :key="e.key" :value="e.key">{{ e.key }}</option></select>
          <select v-model="c.ruleCode" class="input" :aria-label="t('admin.templates.deadlineRule')"><option value="" disabled>{{ t('admin.templates.deadlineRule') }}</option>
            <option v-for="r in deadlineRules" :key="r.code" :value="r.code">{{ r.name?.[lang] || r.code }}</option></select>
          <select v-model="c.toEventKey" class="input" :aria-label="t('admin.templates.toEvent')"><option value="">{{ t('admin.templates.toEventNone') }}</option><option v-for="e in f.process.timeline.events" :key="e.key" :value="e.key">{{ e.key }}</option></select>
          <input v-model.number="c.extensionDays" type="number" min="0" class="input" :aria-label="t('admin.templates.extensionDays')" :placeholder="t('admin.templates.extensionDays')" />
          <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.process.timeline.checks.splice(i, 1)"><Icon name="trash" :size="16" /></button>
        </div>
        <button type="button" class="btn btn-ghost mt-3" @click="f.process.timeline.checks.push({ key: `c${f.process.timeline.checks.length + 1}`, label: L(), fromEventKey: '', ruleCode: '', toEventKey: '', extensionDays: 0 })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addCheck') }}</button>
      </section>
    </template>

    <!-- Procedural card: what the engines compute as the right answer -->
    <section v-if="isProcess" class="card grid gap-4 p-5 sm:grid-cols-2">
      <h2 class="font-bold sm:col-span-2">{{ t('admin.templates.processTitle') }}</h2>
      <p class="-mt-2 text-xs text-ink-mute sm:col-span-2">{{ t('admin.templates.processHint') }}</p>
      <div class="sm:col-span-2"><label class="label" for="pr-courts">{{ t('admin.templates.courts') }}</label>
        <textarea id="pr-courts" v-model="procCourtsText" class="input" rows="2" :placeholder="t('admin.templates.courtsHint')" /></div>
      <div><label class="label" for="pr-rule">{{ t('admin.templates.deadlineRule') }}</label>
        <select id="pr-rule" v-model="f.process.deadline.ruleCode" class="input"><option value="">{{ t('admin.templates.notChecked') }}</option>
          <option v-for="r in deadlineRules" :key="r.code" :value="r.code">{{ r.name?.[lang] || r.code }} ({{ r.amount }} {{ t(`admin.templates.units.${r.unit}`) }})</option></select></div>
      <div><label class="label" for="pr-ev">{{ t('admin.templates.eventDateVar') }}</label>
        <select id="pr-ev" v-model="f.process.deadline.eventDateVar" class="input"><option value="">{{ t('admin.templates.fixedDate') }}</option><option v-for="v in dateVars" :key="v" :value="v">{{ v }}</option></select></div>
      <div v-if="!f.process.deadline.eventDateVar"><label class="label" for="pr-ed">{{ t('admin.templates.eventDate') }}</label>
        <input id="pr-ed" v-model="f.process.deadline.eventDate" type="date" class="input" /></div>
      <div><label class="label" for="pr-ext">{{ t('admin.templates.extensionDays') }}</label>
        <input id="pr-ext" v-model.number="f.process.deadline.extensionDays" type="number" min="0" class="input" /></div>
      <div><label class="label" for="pr-rate">{{ t('admin.templates.feeRate') }}</label>
        <select id="pr-rate" v-model="f.process.fee.rateCode" class="input"><option value="">{{ t('admin.templates.notChecked') }}</option>
          <option v-for="r in feeRates" :key="r.code" :value="r.code">{{ r.name?.[lang] || r.code }}</option></select></div>
      <div><label class="label" for="pr-inst">{{ t('admin.templates.feeInstance') }}</label>
        <select id="pr-inst" v-model="f.process.fee.instance" class="input"><option v-for="i in ['first', 'appeal', 'cassation', 'revision']" :key="i" :value="i">{{ t(`admin.templates.instances.${i}`) }}</option></select></div>
      <div><label class="label" for="pr-av">{{ t('admin.templates.amountVar') }}</label>
        <select id="pr-av" v-model="f.process.fee.amountVar" class="input"><option value="">-</option><option v-for="v in moneyVars" :key="v" :value="v">{{ v }}</option></select></div>
      <div><label class="label" for="pr-fd">{{ t('admin.templates.dateVar') }}</label>
        <select id="pr-fd" v-model="f.process.fee.filingDateVar" class="input"><option value="">{{ t('admin.templates.todayDate') }}</option><option v-for="v in dateVars" :key="v" :value="v">{{ v }}</option></select></div>
      <label class="flex items-center gap-2 text-sm"><input v-model="f.process.fee.isSme" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.templates.isSme') }}</label>
    </section>

    <!-- Variables -->
    <section class="card p-5">
      <h2 class="font-bold">{{ t('admin.templates.variables') }}</h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.variablesHint') }}</p>
      <div v-for="(v, i) in f.variablesSchema" :key="i" class="mt-3 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
        <input v-model.trim="v.key" class="input" placeholder="debt" :aria-label="t('admin.templates.varKey')" />
        <select v-model="v.kind" class="input" :aria-label="t('admin.templates.varKind')">
          <option value="money">{{ t('admin.templates.kinds.money') }}</option><option value="date">{{ t('admin.templates.kinds.date') }}</option><option value="choice">{{ t('admin.templates.kinds.choice') }}</option>
        </select>
        <template v-if="v.kind !== 'choice'">
          <input v-model.number="v.min" type="number" class="input" :placeholder="v.kind === 'date' ? t('admin.templates.minDays') : t('admin.templates.min')" :aria-label="t('admin.templates.min')" />
          <input v-model.number="v.max" type="number" class="input" :placeholder="v.kind === 'date' ? t('admin.templates.maxDays') : t('admin.templates.max')" :aria-label="t('admin.templates.max')" />
          <input v-if="v.kind === 'money'" v-model.number="v.step" type="number" min="1" class="input" :placeholder="t('admin.templates.step')" :aria-label="t('admin.templates.step')" />
          <span v-else />
        </template>
        <textarea v-else v-model="v.optionsText" class="input sm:col-span-3" rows="2" :placeholder="t('admin.templates.optionsHint')" />
        <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.variablesSchema.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button type="button" class="btn btn-ghost mt-3" @click="f.variablesSchema.push({ key: '', kind: 'money', min: 0, max: 0, step: 1000000, optionsText: '' })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addVariable') }}</button>
    </section>

    <!-- Scaffold, checklist, norms -->
    <section v-if="isDraft || isRoute" class="card p-5">
      <h2 class="font-bold">{{ t('admin.templates.scaffold') }}</h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.scaffoldHint') }}</p>
      <div v-for="(s, i) in f.scaffold" :key="i" class="mt-3 rounded-xl border border-line p-3">
        <LocalizedField v-model="s.title" :label="t('admin.templates.sectionTitle', { n: i + 1 })" />
        <LocalizedField v-model="s.hint" class="mt-2" :label="t('admin.templates.sectionHint')" />
        <button type="button" class="btn btn-link mt-1 !px-0 text-bad" @click="f.scaffold.splice(i, 1)">{{ t('common.delete') }}</button>
      </div>
      <button type="button" class="btn btn-ghost mt-3" @click="f.scaffold.push({ title: { ru: '', uz: '' }, hint: { ru: '', uz: '' } })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addSection') }}</button>
    </section>

    <section class="card p-5">
      <h2 class="font-bold">{{ t('admin.templates.checklist') }}</h2>
      <div v-for="(c, i) in f.checklist" :key="i" class="mt-3 flex items-start gap-2">
        <LocalizedField v-model="f.checklist[i]" class="flex-1" :label="`${i + 1}`" />
        <button type="button" class="btn-icon btn mt-6 text-bad" :aria-label="t('common.delete')" @click="f.checklist.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button type="button" class="btn btn-ghost mt-3" @click="f.checklist.push({ ru: '', uz: '' })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addItem') }}</button>
    </section>

    <section class="card p-5">
      <h2 class="font-bold">{{ t('admin.templates.norms') }}</h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.normsHint') }}</p>
      <div v-for="(n, i) in f.relatedNorms" :key="i" class="mt-3 flex gap-2">
        <input v-model.trim="n.code" class="input !w-32" placeholder="ЭПК" :aria-label="t('admin.templates.normCode')" />
        <input v-model.trim="n.article" class="input !w-32" placeholder="151" :aria-label="t('task.article')" />
        <button type="button" class="btn-icon btn text-bad" :aria-label="t('common.delete')" @click="f.relatedNorms.splice(i, 1)"><Icon name="trash" :size="16" /></button>
      </div>
      <button type="button" class="btn btn-ghost mt-3" @click="f.relatedNorms.push({ code: 'ЭПК', article: '' })"><Icon name="plus" :size="16" /> {{ t('admin.templates.addNorm') }}</button>
    </section>

    <!-- Deterministic check -->
    <section v-if="isDraft" class="card p-5">
      <h2 class="font-bold">{{ t('admin.templates.check') }}</h2>
      <p class="mt-1 text-xs text-ink-mute">{{ t('admin.templates.checkHint') }}</p>
      <label class="mt-3 flex items-center gap-2 text-sm"><input v-model="checkOn" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.templates.checkOn') }}</label>
      <div v-if="checkOn" class="mt-4 grid gap-4 sm:grid-cols-2">
        <div><label class="label" for="av">{{ t('admin.templates.amountVar') }}</label>
          <select id="av" v-model="f.deterministicCheck.params.amountVar" class="input"><option value="">-</option><option v-for="v in moneyVars" :key="v" :value="v">{{ v }}</option></select></div>
        <div><label class="label" for="dv">{{ t('admin.templates.dateVar') }}</label>
          <select id="dv" v-model="f.deterministicCheck.params.filingDateVar" class="input"><option value="">{{ t('admin.templates.todayOption') }}</option><option v-for="v in dateVars" :key="v" :value="v">{{ v }}</option></select></div>
        <div><label class="label" for="fr">{{ t('admin.templates.feeRate') }}</label>
          <select id="fr" v-model="f.deterministicCheck.params.feeRateCode" class="input"><option v-for="r in feeRates" :key="r.code" :value="r.code">{{ r.name?.[lang] || r.code }}</option></select></div>
        <label class="flex items-center gap-2 self-end pb-3 text-sm"><input v-model="f.deterministicCheck.params.isSme" type="checkbox" class="h-4 w-4 accent-[#6A3DE8]" /> {{ t('admin.templates.isSme') }}</label>
        <div class="sm:col-span-2"><label class="label" for="courts">{{ t('admin.templates.courts') }}</label>
          <textarea id="courts" v-model="courtsText" class="input" rows="3" :placeholder="t('admin.templates.courtsHint')" /></div>
      </div>
    </section>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import LocalizedField from '@/components/ui/LocalizedField.vue'
import BodyPicker from '@/components/task/BodyPicker.vue'
import { useRoute } from 'vue-router'
import { apiClient } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'
import EntityPicker from '@/components/ui/EntityPicker.vue'
import UsedBy from '@/components/ui/UsedBy.vue'

// embedded: opened in the side panel of a track or another editor; saving reports the id instead of changing the page
const props = defineProps<{ id: string; embedded?: boolean }>()
const emit = defineEmits<{ saved: [entity: { id: string; title: string }]; deleted: [] }>()
const createdId = ref('')
const tplId = computed(() => createdId.value || props.id)
const { t, locale } = useI18n()
const router = useRouter()
const lang = computed(() => locale.value as 'ru' | 'uz')
const isNew = computed(() => tplId.value === 'new')
const L = () => ({ ru: '', uz: '' })

const baseTaskTypes = ['draft_full', 'draft_part', 'review_contract', 'review_fix_check', 'review_court_act', 'review_admin_act', 'mines', 'extraction_compare', 'proc_next_step', 'proc_timeline', 'proc_draft', 'route_and_apply', 'sim_branching']
// TCH-5: the same editor works for teachers, who save drafts and send them for review
const route = useRoute()
const teacherMode = computed(() => route.path.startsWith('/teacher'))
const base = computed(() => (teacherMode.value ? '/teacher/content' : '/admin'))
const listPath = computed(() => (teacherMode.value ? '/teacher/content' : '/admin/templates'))
const statuses = computed(() => (teacherMode.value ? ['draft', 'review'] : ['draft', 'review', 'published']))
// The hearing scenarios live in the admin panel only
const taskTypes = computed(() => (teacherMode.value ? baseTaskTypes : [...baseTaskTypes, 'sim_hearing']))
const f = reactive<any>({
  taskType: 'draft_full', difficulty: 2, status: 'draft', skills: [{ key: '', weight: 1 }],
  title: L(), instructions: L(), context: { role: L(), today: '' }, caseText: L(), lockedDocument: L(), referenceAnswer: L(),
  variablesSchema: [], scaffold: [], checklist: [], relatedNorms: [], aiRewrite: true,
  deterministicCheck: { kind: 'none', params: { amountVar: '', filingDateVar: '', feeRateCode: 'property', isSme: false, acceptableCourts: [] } },
  review: { documentId: null, clientSide: '', clientGoals: L() },
  process: {
    acceptableCourts: [], deadline: { ruleCode: '', eventDateVar: '', eventDate: '', extensionDays: 0 }, fee: { rateCode: '', amountVar: '', amount: null, filingDateVar: '', isSme: false, instance: 'first' },
    draftDocType: L(), instructionsHidden: L(), timeline: { events: [], checks: [] }
  },
  route: { clientFacts: [], acceptableRoutes: [] },
  sim: { scenarioId: null, role: '' },
  hearing: { scenarioId: null },
  extraction: { documentIds: [], fields: [], reference: [] },
  timerSec: 0
})
const isDraft = computed(() => f.taskType.startsWith('draft') || f.taskType === 'proc_draft')
// Trainers on a library document: contract review, fix-check, court acts, "mines"
const isReview = computed(() => f.taskType.startsWith('review') || f.taskType === 'mines')
const needsSide = computed(() => ['review_contract', 'review_fix_check', 'review_admin_act'].includes(f.taskType))
const isRoute = computed(() => f.taskType === 'route_and_apply')
const isSim = computed(() => f.taskType === 'sim_branching')
const isHearing = computed(() => f.taskType === 'sim_hearing')
const hearings = ref<any[]>([])
const isExtraction = computed(() => f.taskType === 'extraction_compare')
// Extraction: chosen documents and named terms; the reference grid has one cell per pair
const exDocs = computed(() => f.extraction.documentIds.filter(Boolean).map((id: string) => documents.value.find(d => d._id === id) ?? { _id: id, title: id }))
const exFields = computed(() => f.extraction.fields.filter((x: any) => x.key))
const exActiveDoc = ref('')
// Every document x term pair gets its cell as soon as both exist, so the grid binds to real objects
watch([exDocs, exFields], () => {
  if (!exDocs.value.some((d: any) => d._id === exActiveDoc.value)) exActiveDoc.value = exDocs.value[0]?._id ?? ''
  for (const d of exDocs.value) for (const fl of exFields.value) {
    if (!f.extraction.reference.some((x: any) => x.documentId === d._id && x.fieldKey === fl.key)) f.extraction.reference.push({ documentId: d._id, fieldKey: fl.key, value: '', absent: false, quote: '' })
  }
}, { deep: true, immediate: true })
const refCell = (fieldKey: string) => f.extraction.reference.find((x: any) => x.documentId === exActiveDoc.value && x.fieldKey === fieldKey)
// The six terms PRD 4.8 names; the author edits or removes them
function addPresetFields() {
  f.extraction.fields.push(
    { key: 'parties', kind: 'text', label: { ru: 'Стороны', uz: 'Tomonlar' }, hint: L() },
    { key: 'term', kind: 'text', label: { ru: 'Срок действия', uz: 'Amal qilish muddati' }, hint: L() },
    { key: 'price', kind: 'money', label: { ru: 'Цена', uz: 'Narx' }, hint: L() },
    { key: 'change_of_control', kind: 'bool', label: { ru: 'Change of control', uz: 'Change of control' }, hint: L() },
    { key: 'penalty', kind: 'text', label: { ru: 'Неустойка', uz: 'Neustoyka' }, hint: L() },
    { key: 'jurisdiction', kind: 'text', label: { ru: 'Подсудность споров', uz: 'Nizolarning sudlovligi' }, hint: L() }
  )
}
const docOptions = computed(() => documents.value.filter(d => (f.taskType === 'review_court_act' ? d.type === 'court_act'
  : f.taskType === 'review_admin_act' ? d.type === 'admin_act'
  : f.taskType === 'mines' ? d.flawsCount > 0 : d.type !== 'court_act')))
const scenarios = ref<any[]>([])
const selectedScenario = computed(() => scenarios.value.find(x => x._id === f.sim.scenarioId))
const bodyNameMap = reactive<Record<string, string>>({})
const timerMin = computed({ get: () => Math.round((f.timerSec || 0) / 60), set: (v: number) => { f.timerSec = Math.max(0, Math.round(Number(v) || 0)) * 60 } })
const isProcess = computed(() => f.taskType === 'proc_next_step')
const documents = ref<any[]>([])
const deadlineRules = ref<any[]>([])
const procCourtsText = ref('')
const selectedDoc = computed(() => documents.value.find(x => x._id === f.review.documentId))
const checkOn = ref(false)
const courtsText = ref('')
const skillOptions = ref<any[]>([])
const feeRates = ref<any[]>([])
const errors = ref<string[]>([])
const busy = ref(false)

const moneyVars = computed(() => f.variablesSchema.filter((v: any) => v.kind === 'money' && v.key).map((v: any) => v.key))
const dateVars = computed(() => f.variablesSchema.filter((v: any) => v.kind === 'date' && v.key).map((v: any) => v.key))

onMounted(async () => {
  if (teacherMode.value) {
    const { data: m } = await apiClient.get('/teacher/content/meta')
    scenarios.value = m.scenarios
    skillOptions.value = m.skills.filter((x: any) => x.parentKey)
    feeRates.value = m.feeRates
    documents.value = m.documents
    deadlineRules.value = m.deadlineRules
  } else {
    const [s, r, docs, rules, sc] = await Promise.all([
      apiClient.get('/admin/dictionaries/skills'), apiClient.get('/admin/dictionaries/feeRates'),
      apiClient.get('/admin/documents'), apiClient.get('/admin/dictionaries/deadlineRules'), apiClient.get('/admin/scenarios')
    ])
    scenarios.value = sc.data.scenarios
    reloadHearings()
    skillOptions.value = s.data.items.filter((x: any) => x.parentKey)
    feeRates.value = r.data.items
    documents.value = docs.data.documents
    deadlineRules.value = rules.data.items
  }
  // Problems of a fresh AI draft, passed by the templates list
  const pending = (history.state as any)?.problems
  if (Array.isArray(pending) && pending.length) errors.value = pending.map((d: any) => `${(d.path ?? []).join('.')}: ${d.message}`)
  if (!isNew.value) {
    const { data } = await apiClient.get(`${base.value}/templates/${tplId.value}`)
    const tpl = data.template
    Object.assign(f, {
      ...tpl,
      context: { role: tpl.context?.role ?? L(), today: tpl.context?.today ?? '' },
      lockedDocument: tpl.lockedDocument ?? L(),
      variablesSchema: (tpl.variablesSchema ?? []).map((v: any) => ({ ...v, optionsText: (v.options ?? []).map((o: any) => `${o.ru} | ${o.uz}`).join('\n') })),
      deterministicCheck: { kind: tpl.deterministicCheck?.kind ?? 'none', params: { amountVar: '', filingDateVar: '', feeRateCode: 'property', isSme: false, acceptableCourts: [], ...(tpl.deterministicCheck?.params ?? {}) } },
      review: { documentId: tpl.review?.documentId ?? null, clientSide: tpl.review?.clientSide ?? '', clientGoals: tpl.review?.clientGoals ?? L() },
      process: {
        acceptableCourts: tpl.process?.acceptableCourts ?? [],
        deadline: { ruleCode: '', eventDateVar: '', eventDate: '', extensionDays: 0, ...(tpl.process?.deadline ?? {}) },
        fee: { rateCode: '', amountVar: '', amount: null, filingDateVar: '', isSme: false, instance: 'first', ...(tpl.process?.fee ?? {}) },
        draftDocType: tpl.process?.draftDocType ?? L(),
        instructionsHidden: tpl.process?.instructionsHidden ?? L(),
        timeline: {
          events: (tpl.process?.timeline?.events ?? []).map((e: any) => ({ key: e.key, title: e.title ?? L(), date: e.date ?? '', dateVar: e.dateVar ?? '', text: e.text ?? L() })),
          checks: (tpl.process?.timeline?.checks ?? []).map((c: any) => ({ key: c.key, label: c.label ?? L(), fromEventKey: c.fromEventKey, ruleCode: c.ruleCode, toEventKey: c.toEventKey ?? '', extensionDays: c.extensionDays ?? 0 }))
        }
      },
      route: {
        clientFacts: (tpl.route?.clientFacts ?? []).map((x: any) => ({ key: x.key, text: x.text ?? L(), onRequest: Boolean(x.onRequest) })),
        acceptableRoutes: (tpl.route?.acceptableRoutes ?? []).map((x: any) => ({
          score: x.score ?? 100, comment: x.comment ?? L(),
          steps: (x.steps ?? []).map((st: any) => ({ bodyCode: st.bodyCode, basis: st.basis ?? '', deadline: st.deadline ?? L(), pretrial: Boolean(st.pretrial) }))
        }))
      },
      sim: { scenarioId: tpl.sim?.scenarioId ?? null, role: tpl.sim?.role ?? '' },
      hearing: { scenarioId: tpl.hearing?.scenarioId ? String(tpl.hearing.scenarioId) : null },
      extraction: {
        documentIds: (tpl.extraction?.documentIds ?? []).map(String),
        fields: (tpl.extraction?.fields ?? []).map((x: any) => ({ key: x.key, kind: x.kind ?? 'text', label: x.label ?? L(), hint: x.hint ?? L() })),
        reference: (tpl.extraction?.reference ?? []).map((x: any) => ({ documentId: String(x.documentId), fieldKey: x.fieldKey, value: x.value ?? '', absent: Boolean(x.absent), quote: x.quote ?? '' }))
      },
      timerSec: tpl.timerSec ?? 0
    })
    const codes = [...new Set(f.route.acceptableRoutes.flatMap((x: any) => x.steps.map((st: any) => st.bodyCode)))]
    if (codes.length) {
      const { data: n } = await apiClient.get('/bodies/names', { params: { codes: codes.join(','), locale: locale.value } })
      Object.assign(bodyNameMap, n.names)
    }
    procCourtsText.value = (f.process.acceptableCourts ?? []).join('\n')
    checkOn.value = f.deterministicCheck.kind === 'claim_requisites'
    courtsText.value = (f.deterministicCheck.params.acceptableCourts ?? []).join('\n')
  }
})

// Lists of linked records, refreshed after a record is created or edited in the side panel
async function reloadHearings() {
  if (teacherMode.value) return
  try { hearings.value = (await apiClient.get('/admin/hearings')).data.hearings } catch { hearings.value = [] }
}
async function reloadLinks() {
  if (teacherMode.value) return
  const [docs, sc] = await Promise.all([apiClient.get('/admin/documents'), apiClient.get('/admin/scenarios')])
  documents.value = docs.data.documents
  scenarios.value = sc.data.scenarios
  await reloadHearings()
}

function payload() {
  const { _id, __v, createdAt, updatedAt, authorId, organizationId, mode, source, seedKey, ...rest } = f
  return {
    ...rest,
    context: { role: f.context.role, today: f.context.today || '' },
    variablesSchema: f.variablesSchema.map((v: any) => ({
      key: v.key, kind: v.kind, label: v.label ?? '', min: Number(v.min) || 0, max: Number(v.max) || 0, step: Number(v.step) || 1,
      // "ru | uz" per line
      options: v.kind === 'choice' ? String(v.optionsText || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const [ru, uz] = line.split('|').map(x => x.trim())
        return { ru: ru ?? '', uz: uz ?? '' }
      }) : []
    })),
    skills: f.skills.filter((s: any) => s.key),
    // Cells of removed documents or terms are dropped
    extraction: {
      documentIds: f.extraction.documentIds.filter(Boolean),
      fields: f.extraction.fields,
      reference: f.extraction.reference.filter((c: any) => f.extraction.documentIds.includes(c.documentId) && f.extraction.fields.some((x: any) => x.key && x.key === c.fieldKey))
    },
    process: { ...f.process, acceptableCourts: procCourtsText.value.split('\n').map(s => s.trim()).filter(Boolean) },
    deterministicCheck: checkOn.value
      ? { kind: 'claim_requisites', params: { ...f.deterministicCheck.params, amount: null, filingDate: '', acceptableCourts: courtsText.value.split('\n').map(s => s.trim()).filter(Boolean) } }
      : { kind: 'none', params: { amountVar: '', amount: null, filingDateVar: '', filingDate: '', feeRateCode: 'property', isSme: false, acceptableCourts: [] } }
  }
}

async function save() {
  busy.value = true
  errors.value = []
  try {
    if (isNew.value) {
      const { data } = await apiClient.post(`${base.value}/templates`, payload())
      emit('saved', { id: String(data.template._id), title: f.title?.ru || f.title?.uz || '' })
      if (props.embedded) createdId.value = String(data.template._id)
      else router.replace(`${teacherMode.value ? '/teacher' : '/admin'}/templates/${data.template._id}`)
    } else {
      await apiClient.put(`${base.value}/templates/${tplId.value}`, payload())
      emit('saved', { id: tplId.value, title: f.title?.ru || f.title?.uz || '' })
    }
    toast(t('common.saved'), 'ok')
  } catch (e: any) {
    const err = e?.response?.data?.error
    errors.value = Array.isArray(err?.details) ? err.details.map((d: any) => `${(d.path ?? []).join('.')}: ${d.message}`) : [err?.message || t('errors.generic')]
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!window.confirm(t('admin.templates.confirmDelete'))) return
  try {
    const { data } = await apiClient.delete(`${base.value}/templates/${tplId.value}`)
    toast(data.archived ? t('admin.templates.archived') : t('common.deleted'), 'ok')
    emit('deleted')
    if (!props.embedded) router.push(listPath.value)
  } catch {
    toast(t('teacher.content.cannotDelete'), 'bad')
  }
}

// ADM-8: the template in the import format, to move it between installations
async function exportJson() {
  // Admin: the server export with the documents and the scenario the template uses, ready for import elsewhere
  if (!teacherMode.value) {
    const { data } = await apiClient.get('/admin/import/export', { params: { templateIds: tplId.value } })
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `template-${tplId.value}.json`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  const blob = new Blob([JSON.stringify({ templates: [{ ...payload(), status: 'draft' }] }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `template-${tplId.value}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>
