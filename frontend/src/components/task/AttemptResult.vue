<template>
  <!-- Exam: results are published by the teacher -->
  <section v-if="attempt.status === 'awaiting_publication'" class="card flex flex-col items-center gap-3 p-10 text-center animate-rise">
    <span class="grid h-14 w-14 place-items-center rounded-2xl bg-warn-soft text-warn-dark"><Icon name="clock" :size="26" /></span>
    <h2 class="text-lg font-bold">{{ t('result.examWaitTitle') }}</h2>
    <p class="max-w-md text-sm text-ink-soft">{{ t('result.examWaitText') }}</p>
    <button class="btn btn-ghost mt-2" @click="emit('next')">{{ t('result.backToDashboard') }}</button>
  </section>

  <section v-else class="flex flex-col gap-4 animate-rise">
    <!-- Score -->
    <div class="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <div class="grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-3xl font-extrabold text-white shadow-press" :class="scoreBg">
        {{ attempt.finalScore }}
      </div>
      <div class="flex-1">
        <div class="text-xl font-extrabold">{{ t(`result.labels.${attempt.label}`) }}</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span v-if="instance.taskType !== 'sim_branching' && instance.taskType !== 'sim_hearing' && !instance.runId" class="chip chip-outline">{{ attempt.isExam ? t('task.exam') : t('task.iteration', { n: attempt.iteration }) }}</span>
          <span v-if="attempt.status === 'moderated'" class="chip chip-ok"><Icon name="check" :size="13" /> {{ t('result.moderated') }}</span>
          <span v-else-if="attempt.preliminary" class="chip chip-muted">{{ t('result.preliminary') }}</span>
          <span v-if="attempt.status === 'needs_review'" class="chip chip-warn">{{ t('result.needsReview') }}</span>
          <span v-if="attempt.xpAwarded" class="chip chip-brand"><Icon name="bolt" :size="13" /> +{{ attempt.xpAwarded }} XP</span>
          <span v-if="attempt.iteration === 2 && attempt.instanceBestScore != null" class="chip chip-ok">{{ t('result.best', { n: attempt.instanceBestScore }) }}</span>
        </div>
        <p v-if="attempt.moderation?.comment" class="mt-3 rounded-xl bg-ok-soft p-3 text-sm text-ok-dark">
          <b>{{ t('result.teacherComment') }}:</b> {{ attempt.moderation.comment }}
          <span v-if="attempt.moderation.prevScore != null" class="block text-xs">{{ t('result.prevScore', { n: attempt.moderation.prevScore }) }}</span>
        </p>
      </div>
    </div>

    <!-- Criteria -->
    <div class="card p-5">
      <h3 class="text-lg font-bold">{{ t('result.criteriaTitle') }}</h3>
      <ul class="mt-4 flex flex-col gap-5">
        <li v-for="c in attempt.criteria" :key="c.key">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="font-semibold">{{ t(`result.criteria.${c.key}`) }} <span class="font-normal text-ink-mute">· {{ t('result.weight', { n: c.weight }) }}</span></span>
            <span class="font-extrabold">{{ c.score }}</span>
          </div>
          <ProgressBar class="mt-1.5" :value="c.score" :color="barColor(c.score)" :label="t(`result.criteria.${c.key}`)" />
          <p v-if="c.source === 'engine+ai'" class="mt-1.5 flex items-center gap-1 text-xs font-semibold text-ok-dark"><Icon name="shield" :size="13" /> {{ t('result.engineCapped') }}</p>
          <p v-if="aiCriterion(c.key)?.comment" class="mt-1.5 text-sm text-ink-soft">{{ aiCriterion(c.key)?.comment }}</p>
          <blockquote v-for="(q, i) in aiCriterion(c.key)?.quotes ?? []" :key="i" class="mt-1.5 border-l-2 border-brand-soft pl-3 text-sm italic text-ink-mute">{{ q }}</blockquote>
        </li>
      </ul>
    </div>

    <!-- Engine checks -->
    <div v-if="det && (det.kind === 'requisites' || det.kind === 'process' || det.kind === 'timeline') && det.checks?.length" class="card p-5">
      <h3 class="text-lg font-bold">{{ det.kind === 'process' ? t('result.processTitle') : det.kind === 'timeline' ? t('result.timelineTitle') : t('result.engineTitle') }}</h3>
      <p class="mt-1 text-sm text-ink-mute">{{ attempt.reference ? t('result.engineLead') : t('result.engineHidden') }}</p>
      <ul class="mt-3 divide-y divide-line">
        <li v-for="ch in det.checks" :key="ch.key" class="py-3">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg" :class="ch.ok ? 'bg-ok-soft text-ok-dark' : 'bg-bad-soft text-bad-dark'">
              <Icon :name="ch.ok ? 'check' : 'x'" :size="14" />
            </span>
            <div class="min-w-0 flex-1 text-sm">
              <div class="font-semibold">{{ ch.label || t(`result.checks.${ch.key}`) }} - {{ ch.ok ? t('result.checkOk') : t('result.checkBad') }}</div>
              <div class="mt-0.5 text-ink-soft">{{ t('result.yours') }}: <b>{{ show(ch.actual, ch.key) }}</b></div>
              <div v-if="ch.justified === false" class="text-warn-dark">{{ t('result.noCalc') }}</div>
              <div v-if="!ch.ok && ch.expected !== undefined" class="text-ink-soft">{{ t('result.expected') }}: <b>{{ show(ch.expected, ch.key) }}</b></div>
              <ol v-if="ch.explanation?.length" class="mt-2 list-decimal pl-5 text-ink-mute">
                <li v-for="(s, i) in ch.explanation" :key="i">{{ s }}</li>
              </ol>
              <!-- explainResult: why the student's value differs, in plain words -->
              <template v-if="!ch.ok && attempt.reference">
                <p v-if="explanation(ch.key)" class="mt-2 rounded-xl bg-brand-tint p-3 text-ink-soft"><Icon name="lightbulb" :size="15" class="mr-1 inline text-brand" />{{ explanation(ch.key) }}</p>
                <button v-else type="button" class="btn btn-link mt-1 !px-0" :disabled="explaining === ch.key" @click="explain(ch.key)">
                  <Icon name="sparkles" :size="15" /> {{ explaining === ch.key ? t('common.loading') : t('result.explain') }}
                </button>
              </template>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- Review: summary, the student's edits with AI feedback, the full markup after the reference opens -->
    <template v-if="det?.kind === 'review'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.reviewTitle') }}</h3>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl bg-ok-soft p-3"><div class="text-xs font-semibold text-ok-dark">{{ t('result.found') }}</div><div class="text-2xl font-extrabold text-ok-dark">{{ det.foundItems.length }} / {{ det.targets }}</div></div>
          <div class="rounded-xl bg-warn-soft p-3"><div class="text-xs font-semibold text-warn-dark">{{ t('result.missed') }}</div><div class="text-2xl font-extrabold text-warn-dark">{{ det.missedCount }}</div></div>
          <div class="rounded-xl bg-paper p-3"><div class="text-xs font-semibold text-ink-mute">{{ t('result.extra') }}</div><div class="text-2xl font-extrabold">{{ det.extras.length }}</div></div>
          <div class="rounded-xl bg-bad-soft p-3"><div class="text-xs font-semibold text-bad-dark">{{ t('result.against') }}</div><div class="text-2xl font-extrabold text-bad-dark">{{ det.againstClientItems.length }}</div></div>
        </div>
        <p v-if="!attempt.reference && det.missedCount" class="mt-3 text-sm text-ink-mute">{{ t('result.missedHint') }}</p>
      </div>
      <ReviewEditor :model-value="attempt.answer.items" :text="instance.content.documentText" :title="instance.content.documentTitle" readonly :statuses="itemStatuses">
        <template #item-extra="{ index }">
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span class="chip" :class="statusChip(itemStatuses[index])">{{ t(`result.itemStatus.${itemStatuses[index] ?? 'extra'}`) }}</span>
            <span v-if="itemFeedback(index)" class="chip chip-outline">{{ t(`result.verdict.${itemFeedback(index)!.verdict}`) }}</span>
          </div>
          <p v-if="itemFeedback(index)?.comment" class="mt-2 text-sm text-ink-soft">{{ itemFeedback(index)!.comment }}</p>
          <p v-if="extraFeedback(index)?.comment" class="mt-1 text-sm text-ink-mute">{{ extraFeedback(index)!.comment }}</p>
        </template>
      </ReviewEditor>
      <div v-if="det.markup" class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.markupTitle') }}</h3>
        <ul class="mt-3 flex flex-col gap-3">
          <li v-for="m in det.markup" :key="m.id" class="rounded-xl border border-line p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="chip" :class="m.status === 'found' ? 'chip-ok' : m.status === 'missed' ? 'chip-warn' : 'bg-bad-soft text-bad-dark'">{{ t(`result.markupStatus.${m.status}`) }}</span>
              <span class="chip chip-outline">{{ m.type }}</span>
              <span v-if="m.normRef" class="chip chip-muted">{{ m.normRef }}</span>
            </div>
            <blockquote class="mt-2 border-l-2 border-line pl-3 text-sm italic text-ink-soft">«{{ m.quote }}»</blockquote>
            <p v-if="m.explanation" class="mt-2 text-sm">{{ m.explanation }}</p>
            <p v-if="m.fix" class="mt-1 text-sm text-ok-dark"><b>{{ t('result.fix') }}:</b> {{ m.fix }}</p>
          </li>
        </ul>
      </div>
    </template>

    <!-- Fix-check: decisions, the right ones after the reference opens -->
    <template v-if="det?.kind === 'fix_check'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.fixTitle') }}</h3>
        <p class="mt-1 text-sm text-ink-soft">{{ t('result.fixSummary', { n: det.correct, total: det.total }) }}</p>
        <p v-if="!det.results" class="mt-1 text-sm text-ink-mute">{{ t('result.fixHidden') }}</p>
      </div>
      <FixCheckEditor :model-value="attempt.answer.decisions" :text="instance.content.documentText" :edits="instance.content.counterpartyEdits"
        :title="instance.content.documentTitle" readonly :results="det.results" />
    </template>

    <!-- Timeline: violations against the engine -->
    <template v-if="det?.kind === 'timeline'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.violationsTitle') }}</h3>
        <div class="mt-3 grid grid-cols-3 gap-3">
          <div class="rounded-xl bg-ok-soft p-3"><div class="text-xs font-semibold text-ok-dark">{{ t('result.found') }}</div><div class="text-2xl font-extrabold text-ok-dark">{{ det.violationsFound.length }}</div></div>
          <div class="rounded-xl bg-warn-soft p-3"><div class="text-xs font-semibold text-warn-dark">{{ t('result.missed') }}</div><div class="text-2xl font-extrabold text-warn-dark">{{ det.violationsMissedCount }}</div></div>
          <div class="rounded-xl bg-bad-soft p-3"><div class="text-xs font-semibold text-bad-dark">{{ t('result.noViolation') }}</div><div class="text-2xl font-extrabold text-bad-dark">{{ det.violationsExtra.length }}</div></div>
        </div>
      </div>
      <TimelineEditor :model-value="{ deadlines: attempt.answer.deadlines ?? [], violations: attempt.answer.violations ?? [], summary: attempt.answer.summary ?? '' }"
        :events="instance.content.timelineEvents" :checks="instance.content.timelineChecks" readonly :violation-status="violationStatus" />
    </template>

    <!-- Extraction of terms (4.8): cells against the author's table; the reference values open with the reference -->
    <template v-if="det?.kind === 'extraction'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('extraction.resultTitle') }}</h3>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl bg-ok-soft p-3"><div class="text-xs font-semibold text-ok-dark">{{ t('extraction.status.correct') }}</div><div class="text-2xl font-extrabold text-ok-dark">{{ det.correct }}<span class="text-sm font-semibold"> / {{ det.total }}</span></div></div>
          <div class="rounded-xl bg-warn-soft p-3"><div class="text-xs font-semibold text-warn-dark">{{ t('extraction.status.partial') }}</div><div class="text-2xl font-extrabold text-warn-dark">{{ det.partial }}</div></div>
          <div class="rounded-xl bg-bad-soft p-3"><div class="text-xs font-semibold text-bad-dark">{{ t('extraction.status.wrong') }}</div><div class="text-2xl font-extrabold text-bad-dark">{{ det.wrong }}</div></div>
          <div class="rounded-xl bg-paper p-3"><div class="text-xs font-semibold text-ink-mute">{{ t('extraction.status.empty') }}</div><div class="text-2xl font-extrabold text-ink-soft">{{ det.empty }}</div></div>
        </div>
        <p class="mt-3 text-sm text-ink-mute">{{ attempt.reference ? t('extraction.referenceOpen') : t('extraction.referenceHidden') }}</p>
      </div>
      <ExtractionTable :model-value="attempt.answer.cells ?? []" :documents="instance.content.extraction.documents" :fields="instance.content.extraction.fields" readonly :results="extractionResults" />
    </template>

    <!-- Court act: like the review, plus exact dates and sums in the corrections -->
    <template v-if="det?.kind === 'court_act'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.actTitle') }}</h3>
        <div class="mt-3 grid grid-cols-3 gap-3">
          <div class="rounded-xl bg-ok-soft p-3"><div class="text-xs font-semibold text-ok-dark">{{ t('result.found') }}</div><div class="text-2xl font-extrabold text-ok-dark">{{ det.foundItems.length }} / {{ det.targets }}</div></div>
          <div class="rounded-xl bg-warn-soft p-3"><div class="text-xs font-semibold text-warn-dark">{{ t('result.missed') }}</div><div class="text-2xl font-extrabold text-warn-dark">{{ det.missedCount }}</div></div>
          <div class="rounded-xl bg-bad-soft p-3"><div class="text-xs font-semibold text-bad-dark">{{ t('result.wrongValues') }}</div><div class="text-2xl font-extrabold text-bad-dark">{{ det.wrongValueItems.length }}</div></div>
        </div>
        <p v-if="!det.targets" class="mt-3 text-sm text-ink-soft">{{ t('result.actClean') }}</p>
      </div>
      <ReviewEditor :model-value="attempt.answer.items" :text="instance.content.documentText" :title="instance.content.documentTitle" readonly prefix="act" :statuses="actStatuses">
        <template #item-extra="{ index }">
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span class="chip" :class="statusChip(actStatuses[index])">{{ t(`act.itemStatus.${actStatuses[index] ?? 'extra'}`) }}</span>
            <span v-if="det.wrongValueItems.includes(index)" class="chip bg-bad-soft text-bad-dark">{{ t('result.wrongValue') }}</span>
            <span v-if="itemFeedback(index)" class="chip chip-outline">{{ t(`result.verdict.${itemFeedback(index)!.verdict}`) }}</span>
          </div>
          <p v-if="itemFeedback(index)?.comment" class="mt-2 text-sm text-ink-soft">{{ itemFeedback(index)!.comment }}</p>
          <p v-if="extraFeedback(index)?.comment" class="mt-1 text-sm text-ink-mute">{{ extraFeedback(index)!.comment }}</p>
        </template>
      </ReviewEditor>
      <div v-if="det.markup?.length" class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.actMarkupTitle') }}</h3>
        <ul class="mt-3 flex flex-col gap-3">
          <li v-for="m in det.markup" :key="m.id" class="rounded-xl border border-line p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="chip" :class="m.status === 'found' ? 'chip-ok' : 'chip-warn'">{{ t(`result.markupStatus.${m.status}`) }}</span>
              <span v-if="m.segmentKey" class="chip chip-outline">{{ t(`act.segments.${m.segmentKey}`) }}</span>
              <span v-if="m.normRef" class="chip chip-muted">{{ m.normRef }}</span>
            </div>
            <blockquote class="mt-2 border-l-2 border-line pl-3 text-sm italic text-ink-soft">«{{ m.quote }}»</blockquote>
            <p v-if="m.explanation" class="mt-2 text-sm">{{ m.explanation }}</p>
            <p v-if="m.fix" class="mt-1 text-sm text-ok-dark"><b>{{ t('result.original') }}:</b> {{ m.fix }}</p>
          </li>
        </ul>
      </div>
    </template>

    <!-- "Mines": found, missed, false clicks; the full markup with the reference -->
    <template v-if="det?.kind === 'mines'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.minesTitle') }}</h3>
        <div class="mt-3 grid grid-cols-3 gap-3">
          <div class="rounded-xl bg-ok-soft p-3"><div class="text-xs font-semibold text-ok-dark">{{ t('result.found') }}</div><div class="text-2xl font-extrabold text-ok-dark">{{ det.foundCount }} / {{ det.total }}</div></div>
          <div class="rounded-xl bg-warn-soft p-3"><div class="text-xs font-semibold text-warn-dark">{{ t('result.missed') }}</div><div class="text-2xl font-extrabold text-warn-dark">{{ det.missedCount }}</div></div>
          <div class="rounded-xl bg-bad-soft p-3"><div class="text-xs font-semibold text-bad-dark">{{ t('result.falseClicks') }}</div><div class="text-2xl font-extrabold text-bad-dark">{{ det.falseClicks }}</div></div>
        </div>
        <p v-if="det.clean" class="mt-3 flex items-center gap-2 text-sm font-semibold text-ok-dark"><Icon name="trophy" :size="16" /> {{ t('result.minesClean') }}</p>
      </div>
      <MinesBoard :instance-id="instance.id" :model-value="attempt.answer.items" :text="instance.content.documentText" :title="instance.content.documentTitle"
        :segments="instance.content.mines.segments" :clicks="instance.content.mines.clicks" readonly :statuses="mineStatuses">
        <template #item-extra="{ index }">
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-if="det.wrongOptionItems.includes(index)" class="chip bg-bad-soft text-bad-dark">{{ t('result.wrongOption') }}</span>
            <span v-if="itemFeedback(index)" class="chip chip-outline">{{ t(`result.verdict.${itemFeedback(index)!.verdict}`) }}</span>
          </div>
          <p v-if="itemFeedback(index)?.comment" class="mt-2 text-sm text-ink-soft">{{ itemFeedback(index)!.comment }}</p>
        </template>
      </MinesBoard>
      <div v-if="det.markup" class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.minesMarkupTitle') }}</h3>
        <ul class="mt-3 flex flex-col gap-3">
          <li v-for="m in det.markup" :key="m.id" class="rounded-xl border border-line p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="chip" :class="m.status === 'found' ? 'chip-ok' : 'chip-warn'">{{ t(`result.markupStatus.${m.status}`) }}</span>
              <span v-if="m.normRef" class="chip chip-muted">{{ m.normRef }}</span>
            </div>
            <blockquote class="mt-2 border-l-2 border-line pl-3 text-sm italic text-ink-soft">«{{ m.quote }}»</blockquote>
            <p v-if="m.explanation" class="mt-2 text-sm">{{ m.explanation }}</p>
            <p v-if="m.fix" class="mt-1 text-sm text-ok-dark"><b>{{ t('result.safeWording') }}:</b> {{ m.fix }}</p>
          </li>
        </ul>
      </div>
    </template>

    <!-- "Where to apply": the route against the author's routes -->
    <template v-if="det?.kind === 'route'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.routeTitle') }}</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          <span class="chip chip-lg" :class="det.score === 100 ? 'chip-ok' : det.score > 0 ? 'chip-warn' : 'bg-bad-soft text-bad-dark'">{{ t('result.routeScore', { n: det.score }) }}</span>
          <span v-if="det.optimal" class="chip chip-lg chip-ok"><Icon name="check" :size="14" /> {{ t('result.routeOptimal') }}</span>
          <span v-if="det.onRequestTotal" class="chip chip-lg chip-outline">{{ t('result.factsRevealed', { n: det.revealedFacts, total: det.onRequestTotal }) }}</span>
        </div>
        <ul class="mt-3 flex flex-col gap-1.5 text-sm">
          <li v-if="det.missingPretrialCount" class="flex gap-2 text-warn-dark"><Icon name="info" :size="16" class="mt-0.5" /> {{ t('result.missingPretrial', { n: det.missingPretrialCount }) }}<template v-if="det.missingPretrial">: {{ det.missingPretrial.join(', ') }}</template></li>
          <li v-if="det.score > 0 && !det.orderOk" class="flex gap-2 text-warn-dark"><Icon name="info" :size="16" class="mt-0.5" /> {{ t('result.routeOrder') }}</li>
          <li v-for="b in det.wrongBodies" :key="b" class="flex gap-2 text-bad-dark"><Icon name="x" :size="16" class="mt-0.5" /> {{ t('result.wrongBody', { body: b }) }}</li>
        </ul>
        <ol class="mt-4 flex flex-col gap-2">
          <li v-for="(s, i) in attempt.answer.steps" :key="i" class="rounded-xl border border-line p-3 text-sm">
            <div class="font-semibold">{{ i + 1 }}. {{ s.bodyName || s.bodyCode }}</div>
            <div v-if="s.basis || s.deadline" class="mt-0.5 text-ink-soft">{{ [s.basis, s.deadline].filter(Boolean).join(' · ') }}</div>
            <p v-if="stepFeedback(i)" class="mt-1 text-ink-mute">{{ stepFeedback(i) }}</p>
          </li>
        </ol>
      </div>
      <div v-if="det.routes" class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.routesTitle') }}</h3>
        <div v-for="(r, ri) in det.routes" :key="ri" class="mt-3 rounded-xl border p-4" :class="r.matched ? 'border-ok/40 bg-ok-soft' : 'border-line'">
          <div class="flex flex-wrap items-center gap-2">
            <span class="chip" :class="r.score === 100 ? 'chip-ok' : 'chip-outline'">{{ r.score === 100 ? t('result.routeBest') : t('result.routeAcceptable') }}</span>
            <span v-if="r.matched" class="chip chip-brand">{{ t('result.routeYours') }}</span>
          </div>
          <ol class="mt-2 flex flex-col gap-1 text-sm">
            <li v-for="(st, si) in r.steps" :key="si"><b>{{ si + 1 }}. {{ st.name }}</b><span v-if="st.pretrial" class="chip chip-warn ml-2 !py-0">{{ t('result.pretrial') }}</span><span v-if="st.basis || st.deadline" class="text-ink-soft"> - {{ [st.basis, st.deadline].filter(Boolean).join(' · ') }}</span></li>
          </ol>
          <p v-if="r.comment" class="mt-2 text-sm text-ink-soft">{{ r.comment }}</p>
        </div>
        <template v-if="det.onRequestFacts?.length">
          <h4 class="mt-4 font-bold">{{ t('result.factsTitle') }}</h4>
          <ul class="mt-2 flex flex-col gap-1.5 text-sm">
            <li v-for="(f, i) in det.onRequestFacts" :key="i" class="flex gap-2"><Icon :name="f.revealed ? 'check' : 'x'" :size="16" class="mt-0.5" :class="f.revealed ? 'text-ok' : 'text-warn'" /> {{ f.text }}</li>
          </ul>
        </template>
      </div>
    </template>

    <!-- Simulation: the author's verdict on every move -->
    <template v-if="det?.kind === 'sim'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('result.simTitle') }}</h3>
        <p class="mt-2 font-semibold" :class="det.outcome === 'win' ? 'text-ok-dark' : det.outcome === 'loss' ? 'text-bad-dark' : 'text-warn-dark'">{{ t(`sim.outcome.${det.outcome || 'partial'}`) }}</p>
        <ol class="mt-4 flex flex-col gap-3">
          <li v-for="st in det.steps" :key="st.index" class="rounded-xl border border-line p-4 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="st.stage" class="chip chip-outline">{{ st.stage }}</span>
              <span class="chip" :class="{ correct: 'chip-ok', acceptable: 'chip-warn', wrong: 'bg-bad-soft text-bad-dark' }[st.verdict as string]">{{ t(`result.simVerdict.${st.verdict}`) }}</span>
              <span v-if="st.normRef" class="chip chip-muted">{{ st.normRef }}</span>
            </div>
            <p class="mt-2 font-semibold">{{ st.choiceText }}</p>
            <p v-if="st.explanation" class="mt-1 text-ink-soft">{{ st.explanation }}</p>
            <p v-if="st.justification" class="mt-2 rounded-lg bg-paper p-2"><b>{{ t('sim.justification') }}:</b> {{ st.justification }}</p>
            <p v-if="itemFeedback(st.index)" class="mt-1 text-ink-mute"><span class="chip chip-outline mr-1">{{ t(`result.verdict.${itemFeedback(st.index)!.verdict}`) }}</span>{{ itemFeedback(st.index)!.comment }}</p>
          </li>
        </ol>
      </div>
    </template>

    <!-- Hearing: likely outcome, feedback on every reply of the student, the protocol written from the transcript -->
    <template v-if="det?.kind === 'hearing'">
      <div class="card p-5">
        <h3 class="text-lg font-bold">{{ t('hearing.resultTitle') }}</h3>
        <p class="mt-2 font-semibold" :class="det.outcome === 'win' ? 'text-ok-dark' : det.outcome === 'loss' ? 'text-bad-dark' : 'text-warn-dark'">{{ t(`sim.outcome.${det.outcome || 'partial'}`) }}</p>
        <p v-if="det.outcomeReason" class="mt-1 text-sm text-ink-soft">{{ det.outcomeReason }}</p>
        <ol class="mt-4 flex flex-col gap-3">
          <li v-for="r in det.replies" :key="r.index" class="rounded-xl border border-line p-4 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="r.stage" class="chip chip-outline">{{ r.stage }}</span>
              <span v-if="r.voice" class="chip chip-muted"><Icon name="mic" :size="12" /> {{ t('hearing.byVoice') }}</span>
              <span v-if="itemFeedback(r.index)" class="chip" :class="{ strong: 'chip-ok', partial: 'chip-warn', weak: 'bg-bad-soft text-bad-dark' }[itemFeedback(r.index)!.verdict as string]">{{ t(`hearing.verdict.${itemFeedback(r.index)!.verdict}`) }}</span>
            </div>
            <p class="mt-2">{{ r.text }}</p>
            <p v-if="itemFeedback(r.index)" class="mt-1 text-ink-mute">{{ itemFeedback(r.index)!.comment }}</p>
          </li>
        </ol>
      </div>
      <div class="card p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-lg font-bold">{{ t('hearing.protocolTitle') }}</h3>
          <div class="flex gap-2">
            <button class="btn btn-ghost" @click="copyProtocol">{{ t('hearing.copy') }}</button>
            <button class="btn btn-ghost" @click="downloadProtocol">{{ t('hearing.download') }}</button>
          </div>
        </div>
        <pre class="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-4 font-[inherit] text-sm leading-relaxed">{{ det.protocol }}</pre>
      </div>
    </template>

    <!-- Procedural card: comments per field -->
    <div v-if="attempt.fields?.length" class="card p-5">
      <h3 class="text-lg font-bold">{{ det?.kind === 'route' ? t('result.fieldsTitleRoute') : t('result.fieldsTitle') }}</h3>
      <ul class="mt-3 flex flex-col gap-2 text-sm">
        <li v-for="f in attempt.fields" :key="f.field"><b>{{ te(`process.fieldNames.${f.field}`) ? t(`process.fieldNames.${f.field}`) : t(`route.fieldNames.${f.field}`) }}:</b> {{ f.comment }}</li>
      </ul>
    </div>

    <!-- Errors -->
    <div v-if="attempt.errors.length" class="card p-5">
      <h3 class="text-lg font-bold">{{ t('result.errorsTitle') }}</h3>
      <ul class="mt-3 flex flex-col gap-3">
        <li v-for="(e, i) in attempt.errors" :key="i" class="rounded-xl border border-line p-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="chip bg-bad-soft text-bad-dark">{{ te(`errorTypes.${e.errorType}`) ? t(`errorTypes.${e.errorType}`) : e.errorType }}</span>
            <span v-if="e.normRef" class="chip" :class="e.normVerified ? 'chip-ok' : 'chip-muted'" :title="e.normVerified ? t('result.normVerified') : t('result.normNotVerified')">
              <Icon :name="e.normVerified ? 'check' : 'info'" :size="13" /> {{ e.normRef }}
            </span>
          </div>
          <blockquote v-if="e.quote" class="mt-2 border-l-2 border-bad/40 pl-3 text-sm italic text-ink-mute">{{ e.quote }}</blockquote>
          <p class="mt-2 text-sm">{{ e.comment }}</p>
          <p v-if="e.normRef && !e.normVerified" class="mt-1 text-xs text-ink-mute">{{ t('result.normNotVerified') }}</p>
        </li>
      </ul>
    </div>

    <div v-if="attempt.missing.length" class="card p-5">
      <h3 class="text-lg font-bold">{{ t('result.missingTitle') }}</h3>
      <ul class="mt-3 flex flex-col gap-2 text-sm">
        <li v-for="(m, i) in attempt.missing" :key="i" class="flex gap-2"><Icon name="x" :size="16" class="mt-0.5 text-bad" /> {{ m }}</li>
      </ul>
    </div>

    <div class="card p-5">
      <h3 class="text-lg font-bold">{{ t('result.feedbackTitle') }}</h3>
      <p class="mt-2 text-[15px] leading-relaxed">{{ attempt.feedback }}</p>
      <template v-if="attempt.improvedVersion">
        <h4 class="mt-5 font-bold">{{ t('result.improvedTitle') }}</h4>
        <div class="doc-text mt-2 rounded-xl bg-paper p-4">{{ attempt.improvedVersion }}</div>
      </template>
      <details v-if="attempt.answer?.text || attempt.answer?.action || attempt.answer?.qualification" class="mt-5">
        <summary class="cursor-pointer text-sm font-semibold text-brand">{{ t('result.yourAnswer') }}</summary>
        <div v-if="attempt.answer.text" class="doc-text mt-2 rounded-xl border border-line p-4">{{ attempt.answer.text }}</div>
        <template v-else-if="attempt.answer.qualification">
          <h4 class="mt-3 text-sm font-bold">{{ t('route.step1') }}</h4>
          <div class="doc-text mt-1 rounded-xl border border-line p-4">{{ attempt.answer.qualification }}</div>
          <h4 class="mt-3 text-sm font-bold">{{ t('route.step3') }}</h4>
          <div class="doc-text mt-1 rounded-xl border border-line p-4">{{ attempt.answer.document }}</div>
        </template>
        <ProcessCard v-else class="mt-2" :model-value="attempt.answer" readonly />
      </details>
    </div>

    <div v-if="attempt.reference && (attempt.reference.answer || attempt.reference.checklist.length)" class="card border-ok/30 bg-ok-soft p-5">
      <h3 class="flex items-center gap-2 text-lg font-bold text-ok-dark"><Icon name="book" /> {{ t('result.referenceTitle') }}</h3>
      <div v-if="attempt.reference.answer" class="doc-text mt-3 rounded-xl bg-white p-4">{{ attempt.reference.answer }}</div>
      <template v-if="attempt.reference.checklist.length">
        <h4 class="mt-4 font-bold text-ok-dark">{{ t('result.checklistTitle') }}</h4>
        <ul class="mt-2 flex flex-col gap-1.5 text-sm">
          <li v-for="(c, i) in attempt.reference.checklist" :key="i" class="flex gap-2"><Icon name="check" :size="16" class="mt-0.5 text-ok" /> {{ c }}</li>
        </ul>
      </template>
    </div>

    <!-- STD-5: dispute the score -->
    <div v-if="attempt.dispute" class="rounded-xl bg-warn-soft p-4 text-sm text-warn-dark">
      <b>{{ t('result.disputed') }}</b> {{ attempt.dispute.comment }}
    </div>
    <form v-else-if="disputeOpen" class="card p-5" @submit.prevent="sendDispute">
      <label class="label" for="dispute">{{ t('result.disputeLabel') }}</label>
      <textarea id="dispute" v-model="disputeText" class="input" rows="3" :placeholder="t('result.disputeHint')" />
      <div class="mt-3 flex gap-2">
        <button class="btn btn-primary" :disabled="disputeText.trim().length < 10 || disputeBusy">{{ t('result.disputeSend') }}</button>
        <button type="button" class="btn btn-ghost" @click="disputeOpen = false">{{ t('common.cancel') }}</button>
      </div>
    </form>

    <div class="flex flex-wrap gap-3">
      <template v-if="attempt.canRework">
        <button class="btn btn-primary" @click="emit('rework')"><Icon name="pen" :size="18" /> {{ t('result.rework') }}</button>
        <button class="btn btn-ghost" @click="emit('finish')">{{ t('result.finish') }}</button>
      </template>
      <button v-else class="btn btn-primary" @click="emit('next')">{{ instance.runId ? t('caseRun.toCase') : instance.assignmentId ? t('result.backToDashboard') : t('result.next') }} <Icon name="arrowRight" :size="18" /></button>
      <button v-if="attempt.canDispute && !disputeOpen" class="btn btn-link" @click="disputeOpen = true">{{ t('result.dispute') }}</button>
    </div>
    <p v-if="attempt.canRework" class="text-sm text-ink-mute">{{ t('result.reworkHint') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import ReviewEditor from './ReviewEditor.vue'
import FixCheckEditor from './FixCheckEditor.vue'
import ProcessCard from './ProcessCard.vue'
import MinesBoard from './MinesBoard.vue'
import TimelineEditor from './TimelineEditor.vue'
import ExtractionTable, { type CellResult } from './ExtractionTable.vue'
import { scoreTone } from '@/utils/tasks'
import { apiClient, apiErrorCode } from '@/plugins/axios'
import { toast } from '@/components/ui/toast'

const props = defineProps<{ attempt: any; instance: any }>()
const emit = defineEmits<{ rework: []; finish: []; next: []; disputed: [] }>()
const { t, te } = useI18n()

const det = computed(() => props.attempt.deterministic)
// Extraction: status of every cell with the AI comment on text terms (items carry the comments by cell index)
const extractionResults = computed<Record<string, CellResult>>(() => {
  if (det.value?.kind !== 'extraction') return {}
  const comments = new Map<number, string>((props.attempt.items ?? []).map((i: any) => [i.index, i.comment]))
  return Object.fromEntries(det.value.cells.map((c: any) => [`${c.documentId}|${c.fieldKey}`, { ...c, comment: comments.get(c.index) ?? '' }]))
})
const scoreBg = computed(() => ({ ok: 'bg-ok', brand: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-ink-mute' }[scoreTone(props.attempt.finalScore)]))
const barColor = (s: number) => (s >= 86 ? 'var(--ok)' : s >= 71 ? 'var(--brand)' : s >= 56 ? 'var(--warn)' : 'var(--bad)')
const aiCriterion = (key: string) => props.attempt.aiCriteria?.find((c: any) => c.key === key)
const money = (n: number) => `${n.toLocaleString('ru-RU').replace(/ /g, ' ')}`
const show = (v: unknown, key?: string) => {
  if (v == null || v === '') return t('result.notStated')
  if (Array.isArray(v)) return v.join('; ')
  if (typeof v === 'number') return money(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('.')
  return String(v)
}

// Status of each student selection in the review trainer
const itemStatuses = computed<Record<number, string>>(() => {
  const d = det.value
  if (!d || d.kind !== 'review') return {}
  const s: Record<number, string> = {}
  for (const i of d.foundItems) s[i] = 'found'
  for (const i of d.extras) s[i] = d.justifiedExtras.includes(i) ? 'justified' : 'extra'
  for (const i of d.againstClientItems) s[i] = 'against'
  return s
})
const actStatuses = computed<Record<number, string>>(() => {
  const d = det.value
  if (!d || d.kind !== 'court_act') return {}
  const s: Record<number, string> = {}
  for (const i of d.foundItems) s[i] = 'found'
  for (const i of d.extras) s[i] = d.justifiedExtras.includes(i) ? 'justified' : 'extra'
  return s
})
// Mines result: segments of the missed mines are highlighted once the markup opens
const mineStatuses = computed<Record<number, string>>(() => {
  const d = det.value
  if (!d || d.kind !== 'mines' || !d.markup) return {}
  const s: Record<number, string> = {}
  const segs: { from: number; to: number }[] = props.instance.content.mines?.segments ?? []
  for (const m of d.markup.filter((x: any) => x.status === 'missed')) {
    segs.forEach((g, i) => { if (Math.min(g.to, m.to) - Math.max(g.from, m.from) > 0) s[i] = 'missed' })
  }
  return s
})
const violationStatus = computed<Record<string, string>>(() => {
  const d = det.value
  if (!d || d.kind !== 'timeline') return {}
  const s: Record<string, string> = {}
  for (const k of d.violationsFound) s[k] = 'found'
  for (const k of d.violationsExtra) s[k] = 'extra'
  for (const k of d.violationsMissed ?? []) s[k] = 'missed'
  return s
})

const explanations = ref<Record<string, string>>({})
const explaining = ref('')
const explanation = (key: string) => explanations.value[key] || props.attempt.explanations?.[key] || ''
async function explain(key: string) {
  explaining.value = key
  try {
    const { data } = await apiClient.post(`/attempts/${props.attempt.id}/explain`, { key })
    explanations.value = { ...explanations.value, [key]: data.explanation }
  } catch (e) {
    const code = apiErrorCode(e)
    toast(te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'bad')
  } finally {
    explaining.value = ''
  }
}
const stepFeedback = (i: number) => props.attempt.items?.find((x: any) => x.index === i)?.comment ?? ''
const statusChip = (s?: string) => ({ found: 'chip-ok', justified: 'chip-ok', extra: 'chip-muted', against: 'bg-bad-soft text-bad-dark' }[s ?? 'extra'] ?? 'chip-muted')
const itemFeedback = (i: number) => props.attempt.items?.find((x: any) => x.index === i)

// Hearing protocol: copied to the clipboard or saved as a text file
async function copyProtocol() {
  try { await navigator.clipboard.writeText(det.value?.protocol ?? ''); toast(t('hearing.copied'), 'ok') } catch { toast(t('errors.generic'), 'bad') }
}
function downloadProtocol() {
  const blob = new Blob([det.value?.protocol ?? ''], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `protocol-${props.attempt.id}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const extraFeedback = (i: number) => props.attempt.extras?.find((x: any) => x.index === i)

const disputeOpen = ref(false)
const disputeText = ref('')
const disputeBusy = ref(false)
async function sendDispute() {
  disputeBusy.value = true
  try {
    await apiClient.post(`/attempts/${props.attempt.id}/dispute`, { comment: disputeText.value })
    toast(t('result.disputeSent'), 'ok')
    disputeOpen.value = false
    emit('disputed')
  } catch {
    toast(t('errors.generic'), 'bad')
  } finally {
    disputeBusy.value = false
  }
}
</script>
