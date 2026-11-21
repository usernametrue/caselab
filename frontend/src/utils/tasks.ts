import { ref } from 'vue'
import type { Router } from 'vue-router'
import { apiClient, apiErrorCode } from '@/plugins/axios'

// The "case is being generated" screen: shown on every start for at least MIN_GENERATING_MS, so a case taken
// from the prepared pool and a case written live look the same to the student
export const generating = ref(false)
const MIN_GENERATING_MS = 2600

export async function withGenerating<T>(fn: () => Promise<T>): Promise<T> {
    generating.value = true
    const started = Date.now()
    try {
        const result = await fn()
        const rest = MIN_GENERATING_MS - (Date.now() - started)
        if (rest > 0) await new Promise(r => setTimeout(r, rest))
        return result
    } finally {
        generating.value = false
    }
}

// Generates a task (adaptive pick or a chosen template) and opens it
export async function startTask(router: Router, opts: { mode?: string; skillKey?: string; templateId?: string }) {
    try {
        const { data } = await withGenerating(() => opts.templateId
            ? apiClient.post(`/tasks/from-template/${opts.templateId}`)
            : apiClient.post('/tasks/next', { mode: opts.mode, skillKey: opts.skillKey }))
        await router.push({ name: 'Task', params: { id: data.instance.id } })
        return null
    } catch (e) {
        return apiErrorCode(e)
    }
}

export const scoreTone = (score: number | null | undefined) =>
    score == null ? 'muted' : score >= 86 ? 'ok' : score >= 71 ? 'brand' : score >= 56 ? 'warn' : 'bad'
