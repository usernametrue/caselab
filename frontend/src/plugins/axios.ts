import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { App } from 'vue'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

// Access token lives in memory only; the refresh token is an httpOnly cookie set by the API
let accessToken: string | null = null
export const setAccessToken = (token: string | null) => { accessToken = token }
export const getAccessToken = () => accessToken

// Called when the session cannot be refreshed (set by the auth store)
let onSessionExpired: (() => void) | null = null
export const setSessionExpiredHandler = (fn: () => void) => { onSessionExpired = fn }

// Calls that wait for a long LLM answer (document, track, template drafts): the backend may also retry on 429
export const LLM_TIMEOUT = 180000

// Create axios instance with default configuration
const apiClient = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 30000, // 30 seconds timeout
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
})

// Request interceptor
apiClient.interceptors.request.use(
    (config) => {
        // Add auth token if available
        const token = accessToken
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }

        // Log request in development
        if (import.meta.env.DEV) {
            console.log('API Request:', config.method?.toUpperCase(), config.url)
        }

        return config
    },
    (error: unknown) => {
        console.error('Request error:', error)
        return Promise.reject(error)
    }
)

// Response interceptor
apiClient.interceptors.response.use(
    (response) => {
        // Log response in development
        if (import.meta.env.DEV) {
            console.log('API Response:', response.status, response.config.url)
        }

        return response
    },
    async (error: AxiosError) => {
        const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
        const isAuthCall = originalRequest?.url?.startsWith('/auth/')

        // Handle 401 errors (unauthorized)
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthCall) {
            originalRequest._retry = true

            try {
                // Try to refresh token
                // (the httpOnly refresh cookie is sent automatically)
                const newToken = await refreshAccessToken()

                // Retry original request with new token
                originalRequest.headers.Authorization = `Bearer ${newToken}`
                return apiClient(originalRequest)
            } catch (refreshError) {
                // Refresh failed, redirect to login
                console.error('Token refresh failed:', refreshError)
                accessToken = null

                // Redirect to login page
                onSessionExpired?.()
            }
        }

        // Handle network errors
        if (error.code === 'NETWORK_ERROR' || error.code === 'ECONNABORTED') {
            console.error('Network error:', error.message)
            // You can show a global network error message here
        }

        // Log error in development
        if (import.meta.env.DEV) {
            console.error('API Error:', error.response?.status, error.config?.url, error.message)
        }

        return Promise.reject(error)
    }
)

// One refresh request at a time, shared by all requests that got 401 together
let refreshing: Promise<string> | null = null
export function refreshAccessToken(): Promise<string> {
    if (!refreshing) {
        refreshing = axios.post(`${baseURL}/auth/refresh`, {}, { withCredentials: true })
            .then(r => {
                accessToken = r.data.accessToken
                return r.data.accessToken as string
            })
            .finally(() => { refreshing = null })
    }
    return refreshing
}

// Error message from the API format { error: { code, message } }
export function apiErrorCode(e: unknown): string {
    const err = e as AxiosError<{ error?: { code?: string } }>
    if (!err?.response) return 'network'
    return err.response.data?.error?.code || 'generic'
}

// Vue plugin installation function
export default {
    install(app: App) {
        // Make axios available globally as $http
        app.config.globalProperties.$http = apiClient

        // Make axios available via provide/inject
        app.provide('$http', apiClient)
    }
}

// Export the configured axios instance for direct use
export { apiClient }