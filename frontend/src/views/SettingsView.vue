<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ store.isArabic ? 'الإعدادات' : 'Settings' }}</h1>
      <button v-if="!fxOnly && isAdmin" class="btn btn-quiet" type="button" :disabled="downloadingBackup" @click="onDownloadBackup">
        <i class="fas fa-download"></i> {{ downloadingBackup ? '…' : (store.isArabic ? 'تنزيل نسخة احتياطية' : 'Download Backup Snapshot') }}
      </button>
    </div>
    <h2 v-if="fxOnly" class="section-title">{{ store.isArabic ? 'العملات وأسعار الصرف' : 'Currencies & exchange rates' }}</h2>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>

    <template v-else>
      <form v-if="!fxOnly" class="card" @submit.prevent="onSave">
        <h2>{{ store.isArabic ? 'إعدادات المستأجر' : 'Tenant settings' }}</h2>
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

      <section v-if="!fxOnly && store.canManage" class="card">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'مصفوفة الأدوار والصلاحيات' : 'Role & permission matrix' }}</h2>
          <span class="muted">
            {{ store.isArabic ? 'الصلاحيات الفعّالة حسب الدور — للعرض فقط' : 'Effective permissions by role — read only' }}
          </span>
        </div>
        <div class="table-scroll">
          <table class="table matrix-table">
            <thead>
              <tr>
                <th>{{ store.isArabic ? 'الدور' : 'Role' }}</th>
                <th v-for="permission in permissionMatrix.permissions" :key="permission">
                  {{ permissionLabel(permission, store.isArabic) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="role in permissionMatrix.roles" :key="role">
                <th scope="row">{{ roleLabel(role, store.isArabic) }}</th>
                <td v-for="permission in permissionMatrix.permissions" :key="permission">
                  <span
                    class="permission-mark"
                    :class="permissionMatrix.matrix[role]?.[permission] ? 'allowed' : 'denied'"
                    :aria-label="permissionMatrix.matrix[role]?.[permission] ? 'allowed' : 'denied'"
                  >
                    {{ permissionMatrix.matrix[role]?.[permission] ? '✓' : '—' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'العملات المدارة' : 'Managed currencies' }}</h2>
          <span class="muted">
            {{ store.isArabic ? 'العملة الأساسية' : 'Base currency' }}:
            <strong>{{ fx?.baseCurrency || 'USD' }}</strong>
          </span>
        </div>
        <table v-if="fx?.currencies.length" class="table">
          <thead>
            <tr>
              <th>{{ store.isArabic ? 'الرمز' : 'Code' }}</th>
              <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
              <th>{{ store.isArabic ? 'إلى العملة الأساسية' : 'To base' }}</th>
              <th>{{ store.isArabic ? 'من العملة الأساسية' : 'From base' }}</th>
              <th>{{ store.isArabic ? 'مفعّلة' : 'Enabled' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="currency in fx?.currencies || []" :key="currency.id">
              <td><strong>{{ currency.code }}</strong><span v-if="currency.isBaseCurrency" class="tag">{{ store.isArabic ? 'أساسية' : 'base' }}</span></td>
              <td>{{ currency.name }} ({{ currency.symbol }})</td>
              <td>{{ currency.toBaseRate ?? '—' }}</td>
              <td>{{ currency.fromBaseRate ?? '—' }}</td>
              <td>{{ currency.isEnabled ? '✓' : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">{{ store.isArabic ? 'لا توجد عملات مُعدّة بعد.' : 'No currencies configured yet.' }}</p>

        <form class="grid form-row" @submit.prevent="onAddCurrency">
          <label>
            <span>{{ store.isArabic ? 'رمز العملة (3 أحرف)' : 'Currency code (3 letters)' }}</span>
            <input v-model="currencyForm.code" maxlength="3" required />
          </label>
          <label>
            <span>{{ store.isArabic ? 'الاسم' : 'Name' }}</span>
            <input v-model="currencyForm.name" maxlength="100" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'الرمز' : 'Symbol' }}</span>
            <input v-model="currencyForm.symbol" maxlength="10" />
          </label>
          <button class="btn btn-quiet align-end" type="submit" :disabled="savingFx">
            {{ store.isArabic ? 'إضافة عملة' : 'Add currency' }}
          </button>
        </form>
      </section>

      <section class="card">
        <h2>{{ store.isArabic ? 'إضافة سعر صرف' : 'Add exchange rate' }}</h2>
        <p class="muted">
          {{ store.isArabic
            ? 'يُستخدم أحدث سعر مسجّل عند تحويل المبالغ إلى العملة الأساسية.'
            : 'The latest recorded rate is used when converting amounts to the base currency.' }}
        </p>
        <form class="grid" @submit.prevent="onAddRate">
          <label>
            <span>{{ store.isArabic ? 'من' : 'From' }}</span>
            <input v-model="rateForm.fromCurrency" maxlength="3" required />
          </label>
          <label>
            <span>{{ store.isArabic ? 'إلى' : 'To' }}</span>
            <input v-model="rateForm.toCurrency" maxlength="3" required />
          </label>
          <label>
            <span>{{ store.isArabic ? 'السعر' : 'Rate' }}</span>
            <input v-model="rateForm.rate" inputmode="decimal" required />
          </label>
          <label>
            <span>{{ store.isArabic ? 'تاريخ السريان' : 'Effective at' }}</span>
            <input v-model="rateForm.effectiveAt" type="datetime-local" />
          </label>
          <button class="btn btn-primary align-end" type="submit" :disabled="savingFx">
            {{ store.isArabic ? 'حفظ السعر' : 'Save rate' }}
          </button>
        </form>

        <h3 class="sub-title">{{ store.isArabic ? 'السجل' : 'History' }}</h3>
        <table v-if="fx?.rates.length" class="table">
          <thead>
            <tr>
              <th>{{ store.isArabic ? 'الزوج' : 'Pair' }}</th>
              <th>{{ store.isArabic ? 'السعر' : 'Rate' }}</th>
              <th>{{ store.isArabic ? 'التاريخ' : 'Effective at' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rate in fx?.rates || []" :key="rate.id">
              <td>{{ rate.fromCurrency.code }} → {{ rate.toCurrency.code }}</td>
              <td>{{ rate.rate }}</td>
              <td>{{ formatDate(rate.effectiveAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">{{ store.isArabic ? 'لا توجد أسعار مسجّلة بعد.' : 'No exchange rates recorded yet.' }}</p>

        <div v-if="fxMessage" class="message" :class="{ error: fxError }">{{ fxMessage }}</div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, apiPost, errorMessage, tokenStore } from '@/api/client'
import { DEFAULT_PERMISSION_MATRIX, permissionLabel, roleLabel } from '@/config/permissions'
import { useStore } from '@/stores'
import type { ExchangeRateOverview, PermissionMatrix, TenantSettings } from '@/types'

const props = defineProps<{ fxOnly?: boolean }>()
const store = useStore()
const loading = ref(true)
const saving = ref(false)
const savingFx = ref(false)
const message = ref('')
const downloadingBackup = ref(false)
const isAdmin = () => store.user?.role === 'ADMIN'
const fxMessage = ref('')
const isError = ref(false)
const fxError = ref(false)
const rawData = ref('{}')
const fx = ref<ExchangeRateOverview | null>(null)
const permissionMatrix = ref<PermissionMatrix>(DEFAULT_PERMISSION_MATRIX)

const form = reactive({ defaultLanguage: 'en', defaultCurrency: 'USD' })
const currencyForm = reactive({ code: '', name: '', symbol: '' })
const rateForm = reactive({ fromCurrency: '', toCurrency: '', rate: '', effectiveAt: '' })

onMounted(async () => {
  try {
    const requests: Array<Promise<unknown>> = [apiGet<ExchangeRateOverview>('/settings/exchange-rates')]
    if (!props.fxOnly && store.canManage) {
      requests.unshift(apiGet<TenantSettings | null>('/settings'))
      try {
        permissionMatrix.value = (await apiGet<PermissionMatrix>('/settings/permissions')).data
      } catch {
        permissionMatrix.value = DEFAULT_PERMISSION_MATRIX
      }
    } else if (!props.fxOnly) {
      requests.unshift(apiGet<TenantSettings | null>('/settings'))
    }
    const responses = await Promise.all(requests)
    fx.value = (responses[responses.length - 1] as { data: ExchangeRateOverview }).data
    if (!props.fxOnly) {
      const settings = (responses[0] as { data: TenantSettings | null }).data
      if (settings) {
        form.defaultLanguage = settings.defaultLanguage
        form.defaultCurrency = settings.defaultCurrency
        rawData.value = JSON.stringify(settings.data ?? {}, null, 2)
      }
      rateForm.fromCurrency = form.defaultCurrency
      rateForm.toCurrency = fx.value?.baseCurrency || form.defaultCurrency
    }
  } catch (e) {
    isError.value = true
    fxError.value = true
    message.value = errorMessage(e)
    fxMessage.value = message.value
  } finally {
    loading.value = false
  }
})

async function onDownloadBackup(): Promise<void> {
  downloadingBackup.value = true
  message.value = ''
  isError.value = false
  try {
    const token = tokenStore.get()
    const response = await fetch('/api/admin/export-snapshot', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!response.ok) throw new Error(store.isArabic
      ? (response.status === 403 ? 'مطلوب صلاحيات المدير.' : 'تعذّر تصدير النسخة الاحتياطية.')
      : (response.status === 403 ? 'Admin access is required.' : 'Snapshot export failed.'))
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'estateos-snapshot.json'
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    message.value = store.isArabic ? 'تم تنزيل النسخة الاحتياطية.' : 'Backup snapshot downloaded.'
  } catch (e) {
    isError.value = true
    message.value = errorMessage(e as Error)
  } finally {
    downloadingBackup.value = false
  }
}

async function onSave(): Promise<void> {
  message.value = ''
  isError.value = false
  saving.value = true
  try {
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(rawData.value || '{}')
    } catch {
      throw new Error(store.isArabic ? 'بيانات JSON غير صالحة.' : 'Invalid JSON data.')
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
    message.value = store.isArabic ? 'تم حفظ الإعدادات.' : 'Settings saved.'
    await loadFx()
  } catch (e) {
    isError.value = true
    message.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function loadFx(): Promise<void> {
  fx.value = (await apiGet<ExchangeRateOverview>('/settings/exchange-rates')).data
}

function reportFx(messageText: string, failed: boolean): void {
  fxMessage.value = messageText
  fxError.value = failed
}

async function onAddCurrency(): Promise<void> {
  savingFx.value = true
  reportFx('', false)
  try {
    await apiPost('/settings/exchange-rates/currencies', {
      code: currencyForm.code.toUpperCase(),
      name: currencyForm.name || currencyForm.code.toUpperCase(),
      symbol: currencyForm.symbol || currencyForm.code.toUpperCase()
    })
    currencyForm.code = ''
    currencyForm.name = ''
    currencyForm.symbol = ''
    await loadFx()
    reportFx(store.isArabic ? 'تم حفظ العملة.' : 'Currency saved.', false)
  } catch (e) {
    reportFx(errorMessage(e), true)
  } finally {
    savingFx.value = false
  }
}

async function onAddRate(): Promise<void> {
  savingFx.value = true
  reportFx('', false)
  try {
    await apiPost('/settings/exchange-rates', {
      fromCurrency: rateForm.fromCurrency.toUpperCase(),
      toCurrency: rateForm.toCurrency.toUpperCase(),
      rate: rateForm.rate,
      effectiveAt: rateForm.effectiveAt ? new Date(rateForm.effectiveAt).toISOString() : undefined
    })
    await loadFx()
    reportFx(store.isArabic ? 'تم حفظ سعر الصرف.' : 'Exchange rate saved.', false)
  } catch (e) {
    reportFx(errorMessage(e), true)
  } finally {
    savingFx.value = false
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar' : 'en')
}
</script>

<style scoped>
.page { max-width: 980px; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.1rem; margin: 0 0 1rem; }
h3 { font-size: 0.95rem; margin: 1.4rem 0 0.6rem; }
.section-title { margin-top: 0; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; margin-bottom: 1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.9rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #374151; }
label.full { margin-top: 0.9rem; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.55rem 0.65rem; font-size: 0.9rem; font-family: inherit; }
textarea { font-family: ui-monospace, monospace; }
.actions, .form-row { margin-top: 1.2rem; }
.align-end { align-self: end; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.muted { color: #6b7280; font-size: 0.82rem; margin: 0; }
.table { width: 100%; border-collapse: collapse; font-size: 0.84rem; margin-bottom: 0.6rem; }
th, td { text-align: start; padding: 0.5rem 0.6rem; border-bottom: 1px solid #f3f4f6; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.tag { margin-inline-start: 0.35rem; background: #e0e7ff; color: #3730a3; border-radius: 999px; padding: 0.1rem 0.4rem; font-size: 0.65rem; }
.btn { border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-size: 0.88rem; cursor: pointer; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.message { margin-top: 1rem; padding: 0.6rem 0.8rem; border-radius: 8px; background: #dcfce7; color: #166534; font-size: 0.85rem; }
.message.error { background: #fef2f2; color: #991b1b; }
.state, .empty { padding: 2rem; text-align: center; color: #6b7280; }
.table-scroll { overflow-x: auto; }
.matrix-table { min-width: 1100px; }
.matrix-table th:first-child, .matrix-table td:first-child { position: sticky; inset-inline-start: 0; background: #fff; }
.permission-mark { display: inline-block; min-width: 1.4rem; text-align: center; border-radius: 999px; padding: 0.1rem 0.3rem; font-size: 0.8rem; }
.permission-mark.allowed { background: #dcfce7; color: #166534; }
.permission-mark.denied { background: #f3f4f6; color: #9ca3af; }
</style>
