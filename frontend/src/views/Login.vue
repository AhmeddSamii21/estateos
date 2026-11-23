<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="onSubmit">
      <div class="brand"><i class="fas fa-building"></i> EstateOS</div>
      <h1>{{ store.isArabic ? 'تسجيل الدخول' : 'Sign in' }}</h1>
      <p class="muted">{{ store.isArabic ? 'أدخل بيانات حسابك للمتابعة' : 'Use your company account to continue' }}</p>

      <label>
        <span>{{ store.isArabic ? 'البريد الإلكتروني' : 'Email' }}</span>
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        <span>{{ store.isArabic ? 'كلمة المرور' : 'Password' }}</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>

      <div v-if="store.error" class="error" role="alert">{{ store.error }}</div>
      <button class="submit" type="submit" :disabled="store.loading">
        {{ store.loading ? '…' : (store.isArabic ? 'دخول' : 'Sign in') }}
      </button>
      <LanguageSwitcher />
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from '@/stores'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'

const store = useStore()
const router = useRouter()
const route = useRoute()
const email = ref('')
const password = ref('')

async function onSubmit(): Promise<void> {
  try {
    await store.login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch {
    // Error is surfaced by the store.
  }
}
</script>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; background: #eef2ff; padding: 1rem; }
.login-card { width: min(100%, 400px); background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12); display: flex; flex-direction: column; gap: 0.9rem; }
.brand { color: #4f46e5; font-weight: 700; font-size: 1.3rem; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0 0 0.5rem; font-size: 0.88rem; }
label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; color: #374151; }
input { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.7rem; font-size: 0.95rem; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.85rem; }
.submit { border: 0; border-radius: 8px; padding: 0.75rem; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
.submit:disabled { opacity: 0.6; cursor: wait; }
</style>
