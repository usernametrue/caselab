import { defineStore } from 'pinia'
import { apiClient, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from '@/plugins/axios'
import { changeLocale } from '@/utils/i18n'

// Non-secret hint that this browser had a session - skips the refresh call for first-time visitors
const SESSION_HINT = 'lh-has-session'
const hint = {
    get: () => { try { return localStorage.getItem(SESSION_HINT) === '1' } catch { return true } },
    set: (on: boolean) => { try { if (on) localStorage.setItem(SESSION_HINT, '1'); else localStorage.removeItem(SESSION_HINT) } catch { /* storage unavailable */ } }
}

export interface User {
    id: string
    role: 'student' | 'teacher' | 'admin'
    email: string
    fullName: string
    locale: 'ru' | 'uz'
    course: number | null
    startLevel: string | null
    xp: number
    level: number
    hideFromLeaderboard?: boolean
    mustChangePassword: boolean
}

export const useAuthStore = defineStore('auth', {
    state: () => ({
        user: null as User | null,
        ready: false
    }),
    getters: {
        isAuthenticated: (s) => Boolean(s.user),
        needsOnboarding: (s) => s.user?.role === 'student' && !s.user?.startLevel,
        homeRoute: (s) => (s.user?.role === 'admin' ? { name: 'AdminResults' } : s.user?.role === 'teacher' ? { name: 'TeacherGroups' } : { name: 'Dashboard' })
    },
    actions: {
        // Restores the session from the refresh cookie before the router starts
        async init() {
            setSessionExpiredHandler(() => {
                this.user = null
                window.location.href = '/login'
            })
            if (!hint.get()) {
                this.ready = true
                return
            }
            try {
                await refreshAccessToken()
                const { data } = await apiClient.get('/me')
                this.setUser(data.user)
            } catch {
                this.user = null
                hint.set(false)
            } finally {
                this.ready = true
            }
        },
        setUser(user: User | null) {
            this.user = user
            if (user?.locale) void changeLocale(user.locale)
        },
        applySession(data: { accessToken: string; user: User }) {
            setAccessToken(data.accessToken)
            hint.set(true)
            this.setUser(data.user)
        },
        async login(email: string, password: string) {
            const { data } = await apiClient.post('/auth/login', { email, password })
            this.applySession(data)
        },
        async register(payload: Record<string, unknown>) {
            const { data } = await apiClient.post('/auth/register', payload)
            this.applySession(data)
        },
        async changePassword(currentPassword: string, newPassword: string) {
            const { data } = await apiClient.post('/auth/change-password', { currentPassword, newPassword })
            this.applySession(data)
        },
        async update(patch: Record<string, unknown>) {
            const { data } = await apiClient.patch('/me', patch)
            this.setUser(data.user)
        },
        async logout() {
            try {
                await apiClient.post('/auth/logout')
            } finally {
                setAccessToken(null)
                hint.set(false)
                this.user = null
            }
        }
    }
})
