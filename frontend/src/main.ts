import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useStore } from './stores'
import { ensureDemoDecision } from './api/demoAdapter'
import './assets/styles/print.css'

const app = createApp(App)
app.use(createPinia())

const store = useStore()
store.init()
// Decide once whether this is a standalone static demo before any view mounts.
// The router bootstrap then runs through the correct adapter immediately.
void ensureDemoDecision().then(() => {
  app.use(router)
  app.directive('focus', {
    mounted(el: HTMLElement) {
      el.focus()
    }
  })
  app.mount('#app')
})
