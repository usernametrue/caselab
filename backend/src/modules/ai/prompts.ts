import fs from 'fs';
import path from 'path';

// Prompts live in prompts/<name>.v<N>.md (copied next to the compiled code by scripts/copy-assets.js).
// The version goes to attempts.ai.promptVersion.

// Sections: [SYSTEM] - instructions without placeholders (cached as is), [CONTEXT] - material repeated
// between calls (cached after the instructions), [USER] - what changes on every call.
export interface Prompt { system: string; context: string; user: string; version: string }

const cache = new Map<string, Prompt>();

export function loadPrompt(name: string, version: number): Prompt {
    const key = `${name}.v${version}`;
    if (!cache.has(key)) {
        const raw = fs.readFileSync(path.join(__dirname, 'prompts', `${key}.md`), 'utf8');
        const parts: Record<string, string> = {};
        const re = /^\[(SYSTEM|CONTEXT|USER)\]\s*$/gm;
        const marks = [...raw.matchAll(re)];
        marks.forEach((m, i) => { parts[m[1]] = raw.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : raw.length).trim(); });
        cache.set(key, { system: parts.SYSTEM ?? '', context: parts.CONTEXT ?? '', user: parts.USER ?? '', version: key });
    }
    return cache.get(key)!;
}

// The parts of a request for the provider: the instructions stay byte-identical between calls
export const render = (p: Prompt, vars: Record<string, string | number>) => ({
    system: p.system,
    context: fill(p.context, vars),
    user: fill(p.user, vars)
});

export const languageName = (locale: string | null | undefined) => (locale === 'uz' ? "o'zbek tili (lotin yozuvi)" : 'русский');

// {{name}} placeholders; unknown names become empty strings
export const fill = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));

// Student text is data: closing tags inside it must not end the block early
export const escapeBlock = (s: string) => s.replace(/<\/?(student_answer|student_work|student_card|student_path|engine_result|task|case|question|dialog|client_dialog|facts|story|events|student_calc|engine|folder|weak_spots|position|decision|documents|to_judge|transcript|student_replies|protocol)>/gi, m => m.replace(/</g, '‹').replace(/>/g, '›'));
