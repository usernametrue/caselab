import { reactive } from 'vue'

export type ToastKind = 'info' | 'ok' | 'bad' | 'achievement'
export interface ToastItem { id: number; text: string; kind: ToastKind }

export const toasts = reactive<ToastItem[]>([])
let seq = 0

// Short notice at the top, hides after 3.2 s (design system Toast)
export function toast(text: string, kind: ToastKind = 'info', ms = 3200) {
    const id = ++seq
    toasts.push({ id, text, kind })
    setTimeout(() => {
        const i = toasts.findIndex(t => t.id === id)
        if (i >= 0) toasts.splice(i, 1)
    }, ms)
}
