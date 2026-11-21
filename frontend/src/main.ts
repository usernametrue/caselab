import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/onest/400.css'
import '@fontsource/onest/500.css'
import '@fontsource/onest/600.css'
import '@fontsource/onest/700.css'
import '@fontsource/onest/800.css'
import './assets/main.css'
import App from './App.vue'
import router from './router'
import i18n, { waitForI18n } from './utils/i18n'
import http from './plugins/axios'
import { useAuthStore } from './stores/auth'

async function bootstrap() {
    const app = createApp(App)
    const pinia = createPinia()
    app.use(pinia)
    app.use(i18n)
    app.use(http)
    await waitForI18n()
    // The session is restored before the first navigation so guards see the user
    await useAuthStore(pinia).init()
    app.use(router)
    await router.isReady()
    app.mount('#app')
}

bootstrap()
