import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useStore } from './stores'
import './assets/styles/print.css'

const app = createApp(App)
app.use(createPinia())

const store = useStore()
store.init()
void store.bootstrap()

app.use(router)
app.directive('focus', {
  mounted(el: HTMLElement) {
    el.focus()
  }
})
app.mount('#app')
