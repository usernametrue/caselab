import { defineStore } from 'pinia'
import { apiClient } from '@/plugins/axios'

export interface Dashboard {
    xp: number
    level: number
    title: { ru: string; uz: string }
    levelProgress: { from: number; to: number }
    streak: { current: number; best: number; freezes: number }
    solved: number
    achievements: number
    recent: { id: string; instanceId: string; title: string; status: string; finalScore: number | null; iteration: number; createdAt: string }[]
}

// XP, level and streak for the header chips and the dashboard; refreshed after each graded attempt
export const useStatsStore = defineStore('stats', {
    state: () => ({ dashboard: null as Dashboard | null, loading: false }),
    actions: {
        async refresh() {
            this.loading = true
            try {
                const { data } = await apiClient.get('/me/dashboard')
                this.dashboard = data
            } finally {
                this.loading = false
            }
        }
    }
})
