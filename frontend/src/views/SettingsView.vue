<template>
  <div class="page">
    <h1>{{ store.isArabic ? 'الإعدادات' : 'Settings' }}</h1>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>

    <form v-else class="card" @submit.prevent="onSave">
      <div class="grid">
        <label>
          <span>{{ store.isArabic ? 'اللغة الافتراضية' : 'Default language' }}</span>
          <select v-model="form.defaultLanguage">
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'العملة الافتراضية' : 'Default currency' }}</span>
          <input v-model="form.defaultCurrency" maxlength="3" />
        </label>
      </div>
      <label class="full">
        <span>{{ store.isArabic ? 'بيانات إضافية (JSON)' : 'Additional data (JSON)' }}</span>
        <textarea v-model="rawData" rows="8" spellcheck="false"></textarea>
      </label>

      <div v-if="message" class="message" :class="{ error: isError }">{{ message }}</div>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { TenantSettings } from '@/types'

const store = useStore()
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const isError = ref(false)
const rawData = ref('{}')

const form = reactive({ defaultLanguage: 'en', defaultCurrency: 'USD' })

onMounted(async () => {
  try {
    const response = await apiGet<TenantSettings | null>('/settings')
    if (response.data) {
      form.defaultLanguage = response.data.defaultLanguage
      form.defaultCurrency = response.data.defaultCurrency
      rawData.value = JSON.stringify(response.data.data ?? {}, null, 2)
    }
  } catch (e) {
    isError.value = true
    message.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})

async function onSave(): Promise<void> {
  message.value = ''
  isError.value = false
  saving.value = true
  try {
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(rawData.value || '{}')
    } catch {
      throw new Error(store.isArabic ? '?????? JSON ??? ?????.' : 'Invalid JSON data.')
    }
    await apiPatch('/settings', {
      defaultLanguage: form.defaultLanguage,
      defaultCurrency: form.defaultCurrency.toUpperCase(),
      data
    })
    const saved = localStorage.getItem('estateos.language')
    if (saved !== 'ar' && saved !== 'en' && (form.defaultLanguage === 'ar' || form.defaultLanguage === 'en')) {
      store.setLanguage(form.defaultLanguage as 'ar' | 'en')
    }
    message.value = store.isArabic ? '?? ??? ?????????.' : 'Settings saved.'
  } catch (e) {
    isError.value = true
    message.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page { max-width: 760px; }
h1 { font-size: 1.5rem; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.9rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #374151; }
label.full { margin-top: 0.9rem; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.55rem 0.65rem; font-size: 0.9rem; font-family: inherit; }
textarea { font-family: ui-monospace, monospace; }
.actions { margin-top: 1.2rem; }
.btn { border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-size: 0.88rem; cursor: pointer; }
.btn-primary { background: #4f46e5; color: #fff; }
.message { margin-top: 1rem; padding: 0.6rem 0.8rem; border-radius: 8px; background: #dcfce7; color: #166534; font-size: 0.85rem; }
.message.error { background: #fef2f2; color: #991b1b; }
.state { padding: 2rem; text-align: center; color: #6b7280; }
</style>
