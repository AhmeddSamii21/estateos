<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="onSubmit">
      <div class="brand"><i class="fas fa-building"></i> EstateOS</div>
      <h1>{{ store.isArabic ? 'تسجيل الدخول' : 'Sign in' }}</h1>
      <p class="muted">{{ store.isArabic ? 'أدخل بيانات حسابك للمتابعة' : 'Use your company account to continue' }}</p>

      <div v-if="demoMode" class="demo-panel">
        <strong>{{ store.isArabic ? 'العرض الحي — بيانات تجريبية جاهزة' : 'Live Demo — ready-to-use sample data' }}</strong>
        <p>{{ store.isArabic ? 'انقر على أي دور للدخول فوراً، أو استخدم بيانات التعبئة التلقائية أدناه. لا حاجة لخادم أو قاعدة بيانات.' : 'Click a role to sign in instantly, or use the prefilled credentials below. No server or database required.' }}</p>
        <div class="demo-roles">
          <button
            v-for="account in DEMO_LOGIN_ACCOUNTS"
            :key="account.email"
            class="demo-role"
            type="button"
            :disabled="store.loading"
            @click="demoLogin(account.email)"
          >
            {{ store.isArabic ? account.labelAr : account.label }}
          </button>
        </div>
        <div class="demo-hint">
          <code>{{ demoEmail }}</code>
          <code>{{ DEMO_PASSWORD }}</code>
        </div>
        <button class="demo-reset" type="button" @click="onResetDemo">{{ store.isArabic ? 'إعادة بيانات العرض للوضع الأصلي' : 'Reset demo data' }}</button>
      </div>

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
import {
  DEMO_LOGIN_ACCOUNTS,
  DEMO_PASSWORD,
  demoMode,
  resetDemoSession
} from '@/api/client'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'

const store = useStore()
const router = useRouter()
const route = useRoute()
const demoEmail = DEMO_LOGIN_ACCOUNTS[0].email
const email = ref(demoMode.value ? demoEmail : '')
const password = ref(demoMode.value ? DEMO_PASSWORD : '')

async function finishLogin(): Promise<void> {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await router.push(redirect)
}

async function onSubmit(): Promise<void> {
  try {
    await store.login(email.value.trim(), password.value)
    await finishLogin()
  } catch {
    // Error is surfaced by the store.
  }
}

async function demoLogin(selectedEmail: string): Promise<void> {
  email.value = selectedEmail
  password.value = DEMO_PASSWORD
  try {
    await store.login(selectedEmail, DEMO_PASSWORD)
    await finishLogin()
  } catch {
    // Error is surfaced by the store.
  }
}

function onResetDemo(): void {
  resetDemoSession()
  email.value = demoEmail
  password.value = DEMO_PASSWORD
}
</script>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; background: #eef2ff; padding: 1rem; }
.login-card { width: min(100%, 440px); background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12); display: flex; flex-direction: column; gap: 0.9rem; }
.brand { color: #4f46e5; font-weight: 700; font-size: 1.3rem; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0 0 0.5rem; font-size: 0.88rem; }
label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; color: #374151; }
input { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.7rem; font-size: 0.95rem; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.85rem; }
.submit { border: 0; border-radius: 8px; padding: 0.75rem; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
.submit:disabled { opacity: 0.6; cursor: wait; }
.demo-panel { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.55rem; font-size: 0.82rem; }
.demo-panel p { margin: 0; color: #5b21b6; line-height: 1.5; }
.demo-roles { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.demo-role { border: 1px solid #c4b5fd; border-radius: 999px; background: #fff; color: #5b21b6; padding: 0.4rem 0.75rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
.demo-role:hover { background: #ede9fe; }
.demo-role:disabled { opacity: 0.6; cursor: wait; }
.demo-hint { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.demo-hint code { background: #fff; border-radius: 6px; padding: 0.2rem 0.4rem; color: #3730a3; font-size: 0.72rem; }
.demo-reset { align-self: flex-start; border: 0; background: transparent; color: #6d28d9; font-size: 0.75rem; text-decoration: underline; cursor: pointer; padding: 0; }
</style>
