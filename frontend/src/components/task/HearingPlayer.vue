<template>
  <!-- Hearing with AI participants (sim_hearing): the student speaks in his own words, by text or by voice -->
  <div class="flex flex-col gap-4">
    <div v-if="!state" class="card p-6 text-sm text-ink-mute">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- Stages -->
      <div class="card p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand"><Icon name="gavel" :size="18" /></span>
            <div>
              <div class="text-sm font-bold">{{ state.court || state.title }}</div>
              <div v-if="state.caseNumber" class="text-xs text-ink-mute">{{ t('hearing.caseNo', { n: state.caseNumber }) }}</div>
            </div>
          </div>
          <span class="chip chip-brand"><Icon name="user" :size="13" /> {{ state.studentRole.name }}</span>
        </div>
        <ol class="mt-4 flex flex-wrap gap-2">
          <li v-for="(st, i) in state.stages" :key="st.key" class="chip"
            :class="state.finished || i < state.stageIndex ? 'chip-ok' : i === state.stageIndex ? 'chip-brand' : 'chip-outline'">
            <Icon v-if="state.finished || i < state.stageIndex" name="check" :size="13" />
            <template v-else>{{ i + 1 }}.</template>
            {{ st.title }}
          </li>
        </ol>
        <p v-if="!state.finished && currentStage?.studentTask" class="mt-3 rounded-xl bg-brand-tint px-3 py-2 text-sm">
          <b>{{ t('hearing.yourTask') }}:</b> {{ currentStage.studentTask }}
        </p>
      </div>

      <!-- Transcript -->
      <div class="card flex flex-col">
        <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <span class="eyebrow">{{ t('hearing.transcript') }}</span>
          <button v-if="ttsSupported" type="button" class="btn btn-link !py-1 text-xs" @click="toggleTts">
            <Icon :name="tts ? 'volume' : 'volumeOff'" :size="16" /> {{ tts ? t('hearing.ttsOn') : t('hearing.ttsOff') }}
          </button>
        </div>
        <div ref="scroller" class="flex max-h-[560px] min-h-[320px] flex-col gap-3 overflow-y-auto p-4">
          <template v-for="(e, i) in state.transcript" :key="i">
            <div v-if="i === 0 || state.transcript[i - 1].stage !== e.stage" class="my-1 text-center text-[11px] font-bold uppercase tracking-wider text-ink-mute">{{ stageTitle(e.stage) }}</div>
            <div class="flex flex-col" :class="e.speaker === 'student' ? 'items-end' : 'items-start'">
              <span class="mb-1 flex items-center gap-1 px-1 text-xs font-semibold" :class="e.speaker === 'student' ? 'text-brand-dark' : roleTone(e.speaker).name">
                <Icon v-if="e.voice" name="mic" :size="12" /> {{ e.name }}
              </span>
              <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                :class="e.speaker === 'student' ? 'rounded-br-md bg-brand text-white' : `rounded-bl-md ${roleTone(e.speaker).bubble}`">{{ e.text }}</div>
            </div>
          </template>
          <div v-if="busy" class="flex items-center gap-2 text-xs text-ink-mute">
            <span class="typing"><i /><i /><i /></span> {{ t('hearing.thinking') }}
          </div>
        </div>

        <!-- Input -->
        <div v-if="!state.finished" class="border-t border-line p-3">
          <div class="flex items-end gap-2">
            <button v-if="sttSupported" type="button" class="btn-icon btn shrink-0" :class="listening ? 'bg-bad-soft text-bad-dark' : ''"
              :title="listening ? t('hearing.micStop') : t('hearing.micStart')" :aria-label="listening ? t('hearing.micStop') : t('hearing.micStart')" :disabled="busy" @click="toggleMic">
              <Icon name="mic" :size="20" :class="listening ? 'pulse-soft' : ''" />
            </button>
            <div class="relative min-w-0 flex-1">
              <label class="sr-only" for="hearing-input">{{ t('hearing.placeholder') }}</label>
              <textarea id="hearing-input" ref="input" v-model="text" rows="2" class="input !pr-3 text-sm" :placeholder="listening ? t('hearing.listening') : t('hearing.placeholder')"
                :disabled="busy" @keydown.enter.exact.prevent="send" />
              <div v-if="interim" class="pointer-events-none mt-1 truncate px-1 text-xs italic text-ink-mute">{{ interim }}</div>
            </div>
            <button type="button" class="btn btn-primary shrink-0" :disabled="busy || text.trim().length < 2" @click="send">
              <Icon name="send" :size="16" /> <span class="hidden sm:inline">{{ t('hearing.send') }}</span>
            </button>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-mute">
            <span>{{ sttSupported ? t('hearing.inputHint') : t('hearing.noStt') }}</span>
            <button type="button" class="btn btn-link !py-0 text-xs" :disabled="busy || !hasStudentTurns" @click="finishEarly">
              {{ confirmFinish ? t('hearing.finishConfirm') : t('hearing.finish') }}
            </button>
          </div>
          <p v-if="error" class="mt-2 rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad-dark">{{ error }}</p>
        </div>
        <div v-else class="border-t border-line bg-ok-soft px-4 py-3 text-sm font-semibold text-ok-dark">{{ t('hearing.finishedHint') }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/ui/Icon.vue'
import { apiClient, apiErrorCode } from '@/plugins/axios'

interface Entry { speaker: string; name: string; text: string; stage: string; voice?: boolean }
interface State {
  title: string; court: string; caseNumber: string
  studentRole: { name: string; goal: string }
  participants: { key: string; name: string; role: string }[]
  stages: { key: string; title: string; studentTask: string }[]
  stageIndex: number; transcript: Entry[]; finished: boolean
}

const props = defineProps<{ instanceId: string; language: string }>()
const emit = defineEmits<{ finished: [value: boolean] }>()
const { t, te } = useI18n()

const state = ref<State | null>(null)
const text = ref('')
const interim = ref('')
const busy = ref(false)
const error = ref('')
const confirmFinish = ref(false)
const scroller = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
let usedVoice = false

const currentStage = computed(() => state.value?.stages[state.value.stageIndex] ?? null)
const hasStudentTurns = computed(() => Boolean(state.value?.transcript.some(e => e.speaker === 'student')))
const stageTitle = (key: string) => state.value?.stages.find(s => s.key === key)?.title ?? ''

const TONES: Record<string, { name: string; bubble: string }> = {
  judge: { name: 'text-ink', bubble: 'bg-paper text-ink border border-line' },
  opponent: { name: 'text-bad-dark', bubble: 'bg-bad-soft text-ink' },
  other: { name: 'text-ink-soft', bubble: 'bg-brand-tint text-ink' }
}
const roleTone = (key: string) => TONES[state.value?.participants.find(p => p.key === key)?.role ?? 'other'] ?? TONES.other

function scrollDown() {
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
}

function apply(next: State) {
  const before = state.value?.transcript.length ?? 0
  state.value = next
  emit('finished', next.finished)
  scrollDown()
  // New lines of the participants are read aloud when the voice is on
  if (before) speak(next.transcript.slice(before).filter(e => e.speaker !== 'student'))
}

async function load() {
  try { apply((await apiClient.get(`/hearing/${props.instanceId}`)).data.state) } catch { error.value = t('errors.generic') }
}

const errorText = (e: unknown) => {
  const code = apiErrorCode(e)
  return te(`hearing.errors.${code}`) ? t(`hearing.errors.${code}`) : te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
}

async function send() {
  const said = text.value.trim()
  if (busy.value || said.length < 2 || !state.value) return
  stopMic()
  error.value = ''
  busy.value = true
  // The student's line shows at once; the server returns the whole transcript with the answers
  state.value.transcript.push({ speaker: 'student', name: state.value.studentRole.name, text: said, stage: currentStage.value?.key ?? '', voice: usedVoice })
  text.value = ''
  scrollDown()
  try {
    const { data } = await apiClient.post(`/hearing/${props.instanceId}/say`, { text: said, voice: usedVoice })
    usedVoice = false
    apply(data.state)
  } catch (e) {
    state.value.transcript.pop()
    text.value = said
    error.value = errorText(e)
  } finally {
    busy.value = false
    nextTick(() => input.value?.focus())
  }
}

async function finishEarly() {
  if (!confirmFinish.value) { confirmFinish.value = true; setTimeout(() => { confirmFinish.value = false }, 4000); return }
  confirmFinish.value = false
  busy.value = true
  try { apply((await apiClient.post(`/hearing/${props.instanceId}/finish`)).data.state) } catch (e) { error.value = errorText(e) } finally { busy.value = false }
}

// ---------- Voice input: the browser's speech recognition (Chrome, Edge, Safari) ----------
const Recognition: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null
const sttSupported = Boolean(Recognition)
const listening = ref(false)
let recognizer: any = null

function toggleMic() {
  if (listening.value) { stopMic(); return }
  stopSpeaking()
  try {
    recognizer = new Recognition()
    recognizer.lang = props.language === 'uz' ? 'uz-UZ' : 'ru-RU'
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.onresult = (ev: any) => {
      let partial = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (r.isFinal) {
          const chunk = r[0].transcript.trim()
          if (chunk) { text.value = text.value ? `${text.value.trimEnd()} ${chunk}` : chunk; usedVoice = true }
        } else partial += r[0].transcript
      }
      interim.value = partial
    }
    recognizer.onerror = (ev: any) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') error.value = t('hearing.micDenied')
      stopMic()
    }
    recognizer.onend = () => { listening.value = false; interim.value = '' }
    recognizer.start()
    listening.value = true
    error.value = ''
  } catch {
    listening.value = false
    error.value = t('hearing.noStt')
  }
}
function stopMic() {
  try { recognizer?.stop() } catch { /* already stopped */ }
  listening.value = false
  interim.value = ''
}

// ---------- Voice output: the browser reads the participants' lines ----------
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
const tts = ref(false)
try { tts.value = localStorage.getItem('lh-hearing-tts') === '1' } catch { /* storage unavailable */ }
function toggleTts() {
  tts.value = !tts.value
  try { localStorage.setItem('lh-hearing-tts', tts.value ? '1' : '0') } catch { /* storage unavailable */ }
  if (!tts.value) stopSpeaking()
}
function voiceFor() {
  const lang = props.language === 'uz' ? 'uz' : 'ru'
  return window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang)) ?? null
}
// Each participant gets a slightly different pitch, so the voices are told apart
const PITCH: Record<string, number> = { judge: 0.85, opponent: 1.15, witness: 1.0, expert: 0.95 }
function speak(entries: Entry[]) {
  if (!tts.value || !ttsSupported || !entries.length) return
  const voice = voiceFor()
  for (const e of entries) {
    const u = new SpeechSynthesisUtterance(e.text)
    u.lang = props.language === 'uz' ? 'uz-UZ' : 'ru-RU'
    if (voice) u.voice = voice
    u.pitch = PITCH[state.value?.participants.find(p => p.key === e.speaker)?.role ?? ''] ?? 1
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  }
}
function stopSpeaking() { if (ttsSupported) window.speechSynthesis.cancel() }

watch(() => props.instanceId, load)
onMounted(load)
onBeforeUnmount(() => { stopMic(); stopSpeaking() })
</script>

<style scoped>
.typing { display: inline-flex; gap: 3px; }
.typing i { width: 6px; height: 6px; border-radius: 9999px; background: var(--ink-mute); animation: blink 1.2s infinite ease-in-out; }
.typing i:nth-child(2) { animation-delay: 0.2s; }
.typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
</style>
