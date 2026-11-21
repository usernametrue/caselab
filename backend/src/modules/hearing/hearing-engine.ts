import { z } from 'zod';
import { HttpError } from '../../utils/http';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { escapeBlock, languageName, loadPrompt, render } from '../ai/prompts';
import { LlmUnavailableError } from '../ai/llm-provider';
import { logWarn } from '../../logger';

// Hearing simulation (sim_hearing): stages and participants come from the author's scenario, the AI speaks for the
// participants, the code keeps the order (stages, turn limits) and writes the protocol from the transcript.

export interface HearingParticipant { key: string; name: string; role: string; persona: string }
export interface HearingStage { key: string; title: string; goal: string; studentTask: string; opening: string; openingBy: string; maxTurns: number }
export interface HearingScenario {
    title: string;
    language: 'ru' | 'uz';
    court: string;
    caseNumber: string;
    caseText: string;
    hiddenFacts: string;
    studentRole: { name: string; goal: string };
    participants: HearingParticipant[];
    stages: HearingStage[];
    decisionGuide: string;
    criteria: { key: string; title: string; description: string }[];
}

export const STUDENT = 'student';

export interface TranscriptEntry { speaker: string; name: string; text: string; stage: string; at: Date; voice?: boolean }

// What the student keeps in the instance; the personas, hidden facts and the decision guide stay in "expected"
export interface HearingState {
    title: string;
    court: string;
    caseNumber: string;
    studentRole: { name: string; goal: string };
    participants: { key: string; name: string; role: string }[];
    stages: { key: string; title: string; studentTask: string }[];
    stageIndex: number;
    turnsInStage: number;
    transcript: TranscriptEntry[];
    finished: boolean;
}

const T = {
    ru: {
        nextStage: (title: string) => `Суд переходит к стадии «${title}».`,
        closing: 'Суд удаляется в совещательную комнату. Заседание окончено, решение будет объявлено после совещания.',
        protocol: 'ПРОТОКОЛ СУДЕБНОГО ЗАСЕДАНИЯ',
        case: 'Дело №',
        date: 'Дата',
        chair: 'Председательствующий',
        present: 'В заседании участвуют',
        course: 'Ход судебного заседания',
        student: 'студент',
        end: 'Судебное заседание объявлено закрытым.',
        notHeld: 'Стадия не проводилась.'
    },
    uz: {
        nextStage: (title: string) => `Sud «${title}» bosqichiga o'tadi.`,
        closing: "Sud maslahat xonasiga chiqadi. Majlis yakunlandi, qaror maslahatdan so'ng e'lon qilinadi.",
        protocol: 'SUD MAJLISI BAYONNOMASI',
        case: 'Ish №',
        date: 'Sana',
        chair: 'Raislik qiluvchi',
        present: 'Majlis ishtirokchilari',
        course: 'Sud majlisining borishi',
        student: 'talaba',
        end: 'Sud majlisi yopiq deb e\'lon qilindi.',
        notHeld: "Bosqich o'tkazilmadi."
    }
};
const tr = (lang: string) => (lang === 'uz' ? T.uz : T.ru);

export const judgeOf = (s: { participants: { key: string; name: string; role: string }[] }) => s.participants.find(p => p.role === 'judge') ?? s.participants[0];

// Problems an author must fix before publishing
export function validateHearing(s: HearingScenario) {
    const problems: string[] = [];
    const keys = s.participants.map(p => p.key);
    if (!s.participants.length) problems.push('Add the participants');
    if (!s.participants.some(p => p.role === 'judge')) problems.push('One participant must be the judge');
    if (new Set(keys).size !== keys.length) problems.push('Participant keys must be unique');
    if (keys.includes(STUDENT)) problems.push(`The key "${STUDENT}" is reserved for the student`);
    if (!s.stages.length) problems.push('Add at least one stage');
    const stageKeys = s.stages.map(st => st.key);
    if (new Set(stageKeys).size !== stageKeys.length) problems.push('Stage keys must be unique');
    for (const st of s.stages) {
        if (st.openingBy && !keys.includes(st.openingBy)) problems.push(`Stage "${st.key}": participant "${st.openingBy}" does not exist`);
        if (!st.goal.trim()) problems.push(`Stage "${st.key}": describe its goal`);
    }
    if (!s.studentRole.name.trim()) problems.push('Name the student role');
    return problems;
}

// The words that open a stage: the author's, or a standard line of the judge
function openingOf(s: HearingScenario, index: number, aiText = ''): TranscriptEntry {
    const st = s.stages[index];
    const by = s.participants.find(p => p.key === st.openingBy) ?? judgeOf(s);
    return { speaker: by.key, name: by.name, text: st.opening.trim() || aiText.trim() || tr(s.language).nextStage(st.title), stage: st.key, at: new Date() };
}

export function initialState(s: HearingScenario): HearingState {
    return {
        title: s.title,
        court: s.court,
        caseNumber: s.caseNumber,
        studentRole: { name: s.studentRole.name, goal: s.studentRole.goal },
        participants: s.participants.map(p => ({ key: p.key, name: p.name, role: p.role })),
        stages: s.stages.map(st => ({ key: st.key, title: st.title, studentTask: st.studentTask })),
        stageIndex: 0,
        turnsInStage: 0,
        transcript: s.stages.length ? [openingOf(s, 0)] : [],
        finished: false
    };
}

// The student sees the stage hints on difficulty 1-3 only
export function publicHearing(state: HearingState, difficulty: number) {
    return {
        ...state,
        stages: state.stages.map(st => ({ key: st.key, title: st.title, studentTask: difficulty <= 3 ? st.studentTask : '' }))
    };
}

function close(s: HearingScenario, state: HearingState) {
    const judge = judgeOf(s);
    state.finished = true;
    state.transcript.push({ speaker: judge.key, name: judge.name, text: tr(s.language).closing, stage: s.stages[s.stages.length - 1]?.key ?? '', at: new Date() });
}

const turnSchema = z.object({
    replies: z.array(z.object({ speaker: z.string(), text: z.string() })).max(4),
    stageDone: z.boolean(),
    nextStageOpening: z.string()
});

const transcriptText = (state: HearingState, s: HearingScenario) => state.transcript.slice(-40).map(e => {
    const stage = s.stages.find(st => st.key === e.stage)?.title ?? e.stage;
    return `[${stage}] ${e.speaker === STUDENT ? `${e.name} (${STUDENT})` : `${e.name} (${e.speaker})`}: ${e.text}`;
}).join('\n');

// One move of the student: his words go into the transcript, the AI answers for the participants and may close the stage
export async function studentSays(s: HearingScenario, state: HearingState, text: string, voice: boolean) {
    if (state.finished) throw new HttpError(409, 'finished', 'The hearing is over');
    if (!aiAvailable()) throw new HttpError(503, 'ai_unavailable', 'The AI is not available, the hearing cannot go on');
    const stage = s.stages[state.stageIndex];
    const entry: TranscriptEntry = { speaker: STUDENT, name: s.studentRole.name, text, stage: stage.key, at: new Date(), voice };
    const draft: HearingState = { ...state, transcript: [...state.transcript, entry], turnsInStage: state.turnsInStage + 1 };
    const forced = draft.turnsInStage >= stage.maxTurns;
    const next = s.stages[state.stageIndex + 1] ?? null;

    const prompt = loadPrompt('hearing-turn', 2);
    let out: z.infer<typeof turnSchema>;
    try {
        const res = await aiGenerate({
            task: 'hearingTurn',
            promptVersion: prompt.version,
            schema: turnSchema,
            ...render(prompt, {
                language: languageName(s.language),
                court: s.court || '-',
                caseText: escapeBlock(s.caseText || '-'),
                hiddenFacts: s.hiddenFacts || '-',
                studentRole: `${s.studentRole.name}. Цель: ${s.studentRole.goal || '-'}`,
                participants: s.participants.map(p => `- ${p.key} | ${p.name} | ${p.role}\n  ${p.persona || '-'}`).join('\n'),
                stages: s.stages.map((st, i) => `${i + 1}. ${st.key} | ${st.title}: ${st.goal}`).join('\n'),
                decisionGuide: s.decisionGuide || '-',
                stage: `${stage.key} | ${stage.title}\nЦель стадии: ${stage.goal}\nОт студента ждут: ${stage.studentTask || '-'}`,
                turn: `Реплика студента ${draft.turnsInStage} из ${stage.maxTurns} на этой стадии.${forced ? ' Лимит реплик исчерпан: заверши стадию сейчас (stageDone = true).' : ''}`,
                nextStage: next ? `${next.key} | ${next.title}: ${next.goal}` : 'Это последняя стадия: после нее суд удаляется в совещательную комнату, решение не объявляй.',
                transcript: escapeBlock(transcriptText(draft, s))
            })
        });
        out = res.data;
    } catch (e: any) {
        logWarn('hearing turn failed', {}, { error: String(e?.message ?? e) });
        if (e instanceof LlmUnavailableError) throw new HttpError(503, 'ai_unavailable', 'The AI is not available, try again');
        throw new HttpError(502, 'ai_failed', 'The participants could not answer, try again');
    }

    const known = new Map(s.participants.map(p => [p.key, p]));
    for (const r of out.replies) {
        const p = known.get(r.speaker);
        if (!p || !r.text.trim()) continue;
        draft.transcript.push({ speaker: p.key, name: p.name, text: r.text.trim(), stage: stage.key, at: new Date() });
    }
    if (out.stageDone || forced) {
        draft.stageIndex++;
        draft.turnsInStage = 0;
        if (draft.stageIndex >= s.stages.length) close(s, draft);
        else draft.transcript.push(openingOf(s, draft.stageIndex, out.nextStageOpening));
    }
    return draft;
}

// The student ends the hearing before the last stage
export function finishEarly(s: HearingScenario, state: HearingState) {
    if (state.finished) return state;
    if (!state.transcript.some(e => e.speaker === STUDENT)) throw new HttpError(409, 'no_turns', 'Say something in the hearing first');
    const draft = { ...state, transcript: [...state.transcript] };
    close(s, draft);
    return draft;
}

// The protocol is written by code from the transcript: header, participants, the course of the hearing by stages
export function buildProtocol(s: HearingScenario, state: HearingState, date: string) {
    const L = tr(s.language);
    const judge = judgeOf(s);
    const ruDate = date.split('-').reverse().join('.');
    const lines: string[] = [L.protocol, ''];
    if (s.court) lines.push(s.court);
    if (s.caseNumber) lines.push(`${L.case} ${s.caseNumber}`);
    lines.push(`${L.date}: ${ruDate}`, '');
    lines.push(`${L.chair}: ${judge?.name ?? '-'}`);
    lines.push(`${L.present}:`);
    for (const p of s.participants) if (p.key !== judge?.key) lines.push(`- ${p.name}`);
    lines.push(`- ${s.studentRole.name} (${L.student})`, '');
    lines.push(`${L.course}:`, '');
    s.stages.forEach((st, i) => {
        lines.push(`${i + 1}. ${st.title.toUpperCase()}`);
        const said = state.transcript.filter(e => e.stage === st.key);
        if (!said.length) lines.push(L.notHeld);
        for (const e of said) lines.push(`${e.name}: ${e.text}`);
        lines.push('');
    });
    lines.push(L.end);
    return lines.join('\n');
}
