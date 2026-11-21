import { createRouter, createWebHistory, type RouteLocationNormalized, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import i18n from '@/utils/i18n' // Import the i18n instance

// Import views
// ...
const Landing = () => import('@/views/Landing.vue')
const Auth = () => import('@/views/Auth.vue')
const Onboarding = () => import('@/views/Onboarding.vue')
const ChangePassword = () => import('@/views/ChangePassword.vue')
const AppShell = () => import('@/components/layout/AppShell.vue')
const Dashboard = () => import('@/views/student/Dashboard.vue')
const Train = () => import('@/views/student/Train.vue')
const Task = () => import('@/views/student/Task.vue')
const Progress = () => import('@/views/student/Progress.vue')
const Leaderboard = () => import('@/views/student/Leaderboard.vue')
const CaseRun = () => import('@/views/student/CaseRun.vue')
const AdminShell = () => import('@/components/layout/AdminShell.vue')
const AdminResults = () => import('@/views/admin/Results.vue')
const AdminUsers = () => import('@/views/admin/Users.vue')
const AdminTemplates = () => import('@/views/admin/Templates.vue')
const AdminTemplateEdit = () => import('@/views/admin/TemplateEdit.vue')
const AdminDictionaries = () => import('@/views/admin/Dictionaries.vue')
const AdminScoring = () => import('@/views/admin/Scoring.vue')
const AdminDocuments = () => import('@/views/admin/Documents.vue')
const AdminDocumentEdit = () => import('@/views/admin/DocumentEdit.vue')
const AdminScenarios = () => import('@/views/admin/Scenarios.vue')
const AdminScenarioEdit = () => import('@/views/admin/ScenarioEdit.vue')
const AdminHearings = () => import('@/views/admin/Hearings.vue')
const AdminHearingEdit = () => import('@/views/admin/HearingEdit.vue')
const AdminTracks = () => import('@/views/admin/Tracks.vue')
const AdminTrackEdit = () => import('@/views/admin/TrackEdit.vue')
const AdminAudit = () => import('@/views/admin/Audit.vue')
const TeacherContent = () => import('@/views/teacher/Content.vue')
const TeacherShell = () => import('@/components/layout/TeacherShell.vue')
const TeacherGroups = () => import('@/views/teacher/Groups.vue')
const TeacherGroupDetail = () => import('@/views/teacher/GroupDetail.vue')
const TeacherAssignments = () => import('@/views/teacher/Assignments.vue')
const TeacherAssignmentDetail = () => import('@/views/teacher/AssignmentDetail.vue')
const ModerationQueue = () => import('@/views/teacher/ModerationQueue.vue')
const ModerationDetail = () => import('@/views/teacher/ModerationDetail.vue')

const routes: RouteRecordRaw[] = [
    { path: '/', name: 'Landing', component: Landing, meta: { titleKey: 'pageTitles.landing', guestOnly: true } },
    { path: '/login', name: 'Login', component: Auth, props: { mode: 'login' }, meta: { titleKey: 'pageTitles.login', guestOnly: true } },
    { path: '/register', name: 'Register', component: Auth, props: { mode: 'register' }, meta: { titleKey: 'pageTitles.register', guestOnly: true } },
    { path: '/onboarding', name: 'Onboarding', component: Onboarding, meta: { titleKey: 'pageTitles.onboarding', requiresAuth: true } },
    { path: '/change-password', name: 'ChangePassword', component: ChangePassword, meta: { titleKey: 'pageTitles.changePassword', requiresAuth: true } },
    {
        path: '/app',
        component: AppShell,
        meta: { requiresAuth: true },
        children: [
            { path: '', name: 'Dashboard', component: Dashboard, meta: { titleKey: 'pageTitles.dashboard', requiresAuth: true } },
            { path: 'train', name: 'Train', component: Train, meta: { titleKey: 'pageTitles.train', requiresAuth: true } },
            { path: 'task/:id', name: 'Task', component: Task, props: true, meta: { titleKey: 'pageTitles.task', requiresAuth: true } },
            { path: 'progress', name: 'Progress', component: Progress, meta: { titleKey: 'pageTitles.progress', requiresAuth: true } },
            { path: 'case/:id', name: 'CaseRun', component: CaseRun, props: true, meta: { titleKey: 'pageTitles.caseRun', requiresAuth: true } },
            { path: 'leaderboard', name: 'Leaderboard', component: Leaderboard, meta: { titleKey: 'pageTitles.leaderboard', requiresAuth: true } }
        ]
    },
    {
        path: '/admin',
        component: AdminShell,
        meta: { requiresAuth: true, roles: ['admin'] },
        children: [
            { path: '', name: 'AdminResults', component: AdminResults, meta: { titleKey: 'pageTitles.adminResults', requiresAuth: true, roles: ['admin'] } },
            { path: 'users', name: 'AdminUsers', component: AdminUsers, meta: { titleKey: 'pageTitles.adminUsers', requiresAuth: true, roles: ['admin'] } },
            { path: 'templates', name: 'AdminTemplates', component: AdminTemplates, meta: { titleKey: 'pageTitles.adminTemplates', requiresAuth: true, roles: ['admin'] } },
            { path: 'templates/:id', name: 'AdminTemplateEdit', component: AdminTemplateEdit, props: true, meta: { titleKey: 'pageTitles.adminTemplateEdit', requiresAuth: true, roles: ['admin'] } },
            { path: 'dictionaries', name: 'AdminDictionaries', component: AdminDictionaries, meta: { titleKey: 'pageTitles.adminDictionaries', requiresAuth: true, roles: ['admin'] } },
            { path: 'scoring', name: 'AdminScoring', component: AdminScoring, meta: { titleKey: 'pageTitles.adminScoring', requiresAuth: true, roles: ['admin'] } },
            { path: 'documents', name: 'AdminDocuments', component: AdminDocuments, meta: { titleKey: 'pageTitles.adminDocuments', requiresAuth: true, roles: ['admin'] } },
            { path: 'documents/:id', name: 'AdminDocumentEdit', component: AdminDocumentEdit, props: true, meta: { titleKey: 'pageTitles.adminDocumentEdit', requiresAuth: true, roles: ['admin'] } },
            { path: 'scenarios', name: 'AdminScenarios', component: AdminScenarios, meta: { titleKey: 'pageTitles.adminScenarios', requiresAuth: true, roles: ['admin'] } },
            { path: 'scenarios/:id', name: 'AdminScenarioEdit', component: AdminScenarioEdit, props: true, meta: { titleKey: 'pageTitles.adminScenarios', requiresAuth: true, roles: ['admin'] } },
            { path: 'hearings', name: 'AdminHearings', component: AdminHearings, meta: { titleKey: 'pageTitles.adminHearings', requiresAuth: true, roles: ['admin'] } },
            { path: 'hearings/:id', name: 'AdminHearingEdit', component: AdminHearingEdit, props: true, meta: { titleKey: 'pageTitles.adminHearings', requiresAuth: true, roles: ['admin'] } },
            { path: 'tracks', name: 'AdminTracks', component: AdminTracks, meta: { titleKey: 'pageTitles.adminTracks', requiresAuth: true, roles: ['admin'] } },
            { path: 'tracks/:id', name: 'AdminTrackEdit', component: AdminTrackEdit, props: true, meta: { titleKey: 'pageTitles.adminTracks', requiresAuth: true, roles: ['admin'] } },
            { path: 'audit', name: 'AdminAudit', component: AdminAudit, meta: { titleKey: 'pageTitles.adminAudit', requiresAuth: true, roles: ['admin'] } },
            { path: 'moderation', name: 'AdminModeration', component: ModerationQueue, meta: { titleKey: 'pageTitles.moderation', requiresAuth: true, roles: ['admin'] } },
            { path: 'moderation/:id', name: 'AdminModerationDetail', component: ModerationDetail, props: true, meta: { titleKey: 'pageTitles.moderation', requiresAuth: true, roles: ['admin'] } }
        ]
    },
    {
        path: '/teacher',
        component: TeacherShell,
        meta: { requiresAuth: true, roles: ['teacher', 'admin'] },
        children: [
            { path: '', name: 'TeacherGroups', component: TeacherGroups, meta: { titleKey: 'pageTitles.teacherGroups', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'groups/:id', name: 'TeacherGroupDetail', component: TeacherGroupDetail, props: true, meta: { titleKey: 'pageTitles.teacherGroups', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'assignments', name: 'TeacherAssignments', component: TeacherAssignments, meta: { titleKey: 'pageTitles.teacherAssignments', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'assignments/:id', name: 'TeacherAssignmentDetail', component: TeacherAssignmentDetail, props: true, meta: { titleKey: 'pageTitles.teacherAssignments', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'content', name: 'TeacherContent', component: TeacherContent, meta: { titleKey: 'pageTitles.teacherContent', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'templates/:id', name: 'TeacherTemplateEdit', component: AdminTemplateEdit, props: true, meta: { titleKey: 'pageTitles.adminTemplateEdit', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'documents/:id', name: 'TeacherDocumentEdit', component: AdminDocumentEdit, props: true, meta: { titleKey: 'pageTitles.adminDocumentEdit', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'moderation', name: 'TeacherModeration', component: ModerationQueue, meta: { titleKey: 'pageTitles.moderation', requiresAuth: true, roles: ['teacher', 'admin'] } },
            { path: 'moderation/:id', name: 'TeacherModerationDetail', component: ModerationDetail, props: true, meta: { titleKey: 'pageTitles.moderation', requiresAuth: true, roles: ['teacher', 'admin'] } }
        ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior(to, _from, savedPosition) {
        if (savedPosition) {
            return savedPosition
        } else if (to.hash) {
            return { el: to.hash, behavior: 'smooth' }
        } else {
            return { top: 0, behavior: 'smooth' }
        }
    }
})

// Helper function to update meta description
function updateMetaDescription(description: string) {
    if (!description) return

    let metaDescription = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (metaDescription) {
        metaDescription.content = description
    } else {
        metaDescription = document.createElement('meta')
        metaDescription.name = 'description'
        metaDescription.content = description
        document.head.appendChild(metaDescription)
    }
}

// Navigation guards
router.beforeEach(async (to, _from, next) => {
    // Wait for i18n to be ready
    try {
        await (i18n.global as any).$waitForI18n?.() || Promise.resolve()
    } catch (error) {
        console.warn('Router: i18n not ready, using fallback titles')
    }

    // Update page title and description
    updatePageTitleAndDescription(to)

    // Check authentication
    const authStore = useAuthStore()
    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        next({ name: 'Login', query: { redirect: to.fullPath } })
    } else if (authStore.isAuthenticated && to.meta.guestOnly) {
        next(authStore.homeRoute)
    } else if (authStore.isAuthenticated && authStore.user?.mustChangePassword && to.name !== 'ChangePassword') {
        // AUTH-6: a temporary password must be changed before anything else
        next({ name: 'ChangePassword' })
    } else if (authStore.isAuthenticated && authStore.needsOnboarding && to.name !== 'Onboarding' && to.name !== 'ChangePassword') {
        // AUTH-4: a student picks the start level after the first login
        next({ name: 'Onboarding' })
    } else if (Array.isArray(to.meta.roles) && !to.meta.roles.includes(authStore.user?.role)) {
        next(authStore.homeRoute)
    } else {
        next()
    }
})

// Function to update page title and description
function updatePageTitleAndDescription(route: RouteLocationNormalized) {
    // Set page title
    if (route.meta.titleKey) {
        try {
            const title = i18n.global.t(route.meta.titleKey as string)
            if (title && title !== route.meta.titleKey) {
                document.title = `${title} | CaseLab`
            } else {
                // Fallback if translation not found
                document.title = 'CaseLab'
            }
        } catch (error) {
            console.warn('Router: Error setting title:', error)
            document.title = 'CaseLab'
        }
    } else {
        // Default title
        document.title = 'CaseLab'
    }

    // Set meta description
    if (route.meta.descriptionKey) {
        try {
            const description = i18n.global.t(route.meta.descriptionKey as string)
            if (description && description !== route.meta.descriptionKey) {
                updateMetaDescription(description)
            }
        } catch (error) {
            console.warn('Router: Error setting description:', error)
        }
    }
}

// Watch for locale changes and update current page title
let localeWatcher: unknown = null
router.afterEach((to) => {
    // Set up locale watcher only once
    if (!localeWatcher) {
        localeWatcher = i18n.global.locale

        // Use Vue's watch if available, otherwise use a simple approach
        if (typeof window !== 'undefined' && (window as any).Vue?.watch) {
            (window as any).Vue.watch(() => (i18n.global.locale as any).value, () => {
                updatePageTitleAndDescription(router.currentRoute.value)
            })
        } else {
            // Fallback: check for locale changes periodically
            let lastLocale = (i18n.global.locale as any).value
            setInterval(() => {
                const currentLocale = (i18n.global.locale as any).value
                if (currentLocale !== lastLocale) {
                    updatePageTitleAndDescription(router.currentRoute.value)
                    lastLocale = currentLocale
                }
            }, 100) // Check every 100ms
        }
    }
})

// Make router globally accessible for i18n utility
if (typeof window !== 'undefined') {
    ;(window as any).__VUE_ROUTER__ = router
}

export default router