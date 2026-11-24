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
          <h2>{{ store.isArabic ? 'قوالب رسائل واتساب' : 'WhatsApp message templates' }}</h2>
          <span class="muted">
            {{ store.isArabic
              ? 'اترك الحقل فارغاً لاستخدام النص الافتراضي — استخدم الحقول الديناميكية مثل customerName.'
              : 'Leave blank for the built-in text — use dynamic fields such as customerName.' }}
          </span>
        </div>
        <div class="grid whatsapp-grid">
          <template v-for="key in whatsappTemplateKeys" :key="key">
            <label>
              <span>{{ whatsappTemplateLabel(key) }} · EN</span>
              <textarea v-model="whatsappTemplates.en[key]" rows="3" maxlength="2000" spellcheck="false"></textarea>
            </label>
            <label>
              <span>{{ whatsappTemplateLabel(key) }} · AR</span>
              <textarea v-model="whatsappTemplates.ar[key]" rows="3" maxlength="2000" dir="rtl" spellcheck="false"></textarea>
            </label>
          </template>
        </div>
        <div class="actions">
          <button class="btn btn-quiet" type="button" :disabled="savingWhatsapp" @click="onSaveWhatsappTemplates">
            {{ savingWhatsapp ? '…' : (store.isArabic ? 'حفظ قوالب واتساب' : 'Save WhatsApp templates') }}
          </button>
          <span v-if="whatsappMessage" class="muted">{{ whatsappMessage }}</span>
        </div>
      </section>

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

      <section v-if="!fxOnly && isAdmin()" class="card webhook-panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'ويب هوك صادرة' : 'Outbound webhooks' }}</h2>
          <span class="muted">
            {{ store.isArabic
              ? 'أحداث المستأجر فقط — للمديرين فقط'
              : 'Tenant-scoped events — administrators only' }}
          </span>
        </div>

        <form class="grid webhook-form" @submit.prevent="onCreateWebhook">
          <label class="full">
            <span>{{ store.isArabic ? 'رابط الاستقبال (HTTPS أو HTTP محلي)' : 'Receiver URL (HTTPS or local HTTP)' }}</span>
            <input v-model="webhookForm.url" type="url" maxlength="2048" required :placeholder="store.isArabic ? 'https://example.com/webhooks' : 'https://example.com/webhooks'" />
          </label>
          <div class="full">
            <span class="field-label">{{ store.isArabic ? 'الأحداث' : 'Events' }}</span>
            <div class="event-grid">
              <label v-for="code in WEBHOOK_EVENT_CODES" :key="code" class="event-choice">
                <input v-model="webhookForm.events" type="checkbox" :value="code" />
                <code>{{ code }}</code>
              </label>
            </div>
          </div>
          <label class="event-choice align-end">
            <input v-model="webhookForm.isActive" type="checkbox" />
            <span>{{ store.isArabic ? 'مفعّل' : 'Active' }}</span>
          </label>
          <button class="btn btn-primary align-end" type="submit" :disabled="webhookSaving">
            {{ webhookSaving ? '…' : (store.isArabic ? 'إضافة نقطة نهاية' : 'Add endpoint') }}
          </button>
        </form>

        <div v-if="webhookSecretOnce" class="secret-once">
          <strong>{{ store.isArabic ? 'سر التوقيع (يُعرض مرة واحدة فقط):' : 'Signing secret (shown once only):' }}</strong>
          <code>{{ webhookSecretOnce }}</code>
        </div>
        <div v-if="webhookMessage" class="message" :class="{ error: webhookError }">{{ webhookMessage }}</div>

        <h3 class="sub-title">{{ store.isArabic ? 'نقاط النهاية' : 'Endpoints' }}</h3>
        <div v-if="webhookEndpoints.length" class="table-scroll">
          <table class="table webhook-table">
            <thead>
              <tr>
                <th>{{ store.isArabic ? 'الرابط' : 'URL' }}</th>
                <th>{{ store.isArabic ? 'الأحداث' : 'Events' }}</th>
                <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
                <th>{{ store.isArabic ? 'إجراء' : 'Action' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="endpoint in webhookEndpoints" :key="endpoint.id">
                <td><code>{{ endpoint.url }}</code></td>
                <td>
                  <span v-for="event in endpoint.events" :key="event" class="tag">{{ event }}</span>
                </td>
                <td>
                  <span class="status-badge" :class="endpoint.isActive ? 'on' : 'off'">
                    {{ endpoint.isActive ? (store.isArabic ? 'مفعّل' : 'Active') : (store.isArabic ? 'متوقف' : 'Disabled') }}
                  </span>
                </td>
                <td>
                  <button class="btn btn-quiet btn-small" type="button" :disabled="webhookSaving" @click="onToggleEndpoint(endpoint)">
                    {{ endpoint.isActive
                      ? (store.isArabic ? 'إيقاف' : 'Disable')
                      : (store.isArabic ? 'تشغيل' : 'Enable') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty">{{ store.isArabic ? 'لا توجد نقاط نهاية بعد.' : 'No webhook endpoints yet.' }}</p>

        <h3 class="sub-title">{{ store.isArabic ? 'سجل الإرسال' : 'Delivery log' }}</h3>
        <div v-if="webhookDeliveries.length" class="table-scroll">
          <table class="table webhook-table">
            <thead>
              <tr>
                <th>{{ store.isArabic ? 'الحدث' : 'Event' }}</th>
                <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
                <th>{{ store.isArabic ? 'المحاولة' : 'Attempt' }}</th>
                <th>{{ store.isArabic ? 'الاستجابة' : 'Response' }}</th>
                <th>{{ store.isArabic ? 'الوقت' : 'Created' }}</th>
                <th>{{ store.isArabic ? 'إجراء' : 'Action' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="delivery in webhookDeliveries" :key="delivery.id">
                <td><code>{{ delivery.event }}</code></td>
                <td>
                  <span class="status-badge" :class="delivery.status.toLowerCase()">{{ delivery.status }}</span>
                  <span v-if="delivery.error" class="delivery-error" :title="delivery.error">!</span>
                </td>
                <td>#{{ delivery.attempt }}</td>
                <td>{{ delivery.responseStatus ?? '—' }}</td>
                <td>{{ formatDate(delivery.createdAt) }}</td>
                <td>
                  <button class="btn btn-quiet btn-small" type="button" :disabled="webhookSaving" @click="onRetryDelivery(delivery)">
                    {{ store.isArabic ? 'إعادة إرسال' : 'Retry' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty">{{ store.isArabic ? 'لا توجد عمليات إرسال بعد.' : 'No deliveries recorded yet.' }}</p>
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
import { cacheWhatsAppOverrides } from '@/utils/whatsapp'
import { useStore } from '@/stores'
import {
  WEBHOOK_EVENT_CODES,
  type ExchangeRateOverview,
  type PermissionMatrix,
  type TenantSettings,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookEndpointList,
  type WebhookDeliveryList,
  type WebhookEventCode
} from '@/types'

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

const whatsappTemplateKeys = [
  'propertyShare',
  'appointmentConfirmation',
  'appointmentReminder',
  'installmentReminder',
  'leadFollowUp'
] as const
type WhatsAppTemplateKey = (typeof whatsappTemplateKeys)[number]
type WhatsAppTemplatesResponse = { templates: Record<'en' | 'ar', Partial<Record<WhatsAppTemplateKey, string>>> }
const whatsappTemplates = reactive<Record<'en' | 'ar', Record<string, string>>>({ en: {}, ar: {} })
const whatsappSaving = ref(false)
const whatsappMessage = ref('')
const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppTemplateKey, [string, string]> = {
  propertyShare: ['Property share pitch', 'نص مشاركة العقار'],
  appointmentConfirmation: ['Appointment confirmation', 'تأكيد الموعد'],
  appointmentReminder: ['Appointment reminder', 'تذكير الموعد'],
  installmentReminder: ['Installment reminder', 'تذكير القسط'],
  leadFollowUp: ['Lead follow-up', 'متابعة العميل']
}
function whatsappTemplateLabel(key: WhatsAppTemplateKey): string {
  const pair = WHATSAPP_TEMPLATE_LABELS[key]
  return store.isArabic ? pair[1] : pair[0]
}

const form = reactive({ defaultLanguage: 'en', defaultCurrency: 'USD' })
const currencyForm = reactive({ code: '', name: '', symbol: '' })
const rateForm = reactive({ fromCurrency: '', toCurrency: '', rate: '', effectiveAt: '' })
const webhookEndpoints = ref<WebhookEndpoint[]>([])
const webhookDeliveries = ref<WebhookDelivery[]>([])
const webhookForm = reactive({ url: '', events: [] as WebhookEventCode[], isActive: true })
const webhookSaving = ref(false)
const webhookMessage = ref('')
const webhookError = ref(false)
const webhookSecretOnce = ref('')

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
    if (!props.fxOnly && store.canManage) await loadWhatsappTemplates()
    if (!props.fxOnly && isAdmin()) await loadWebhooks()
  } catch (e) {
    isError.value = true
    fxError.value = true
    message.value = errorMessage(e)
    fxMessage.value = message.value
  } finally {
    loading.value = false
  }
})

async function loadWhatsappTemplates(): Promise<void> {
  try {
    const response = await apiGet<WhatsAppTemplatesResponse>('/settings/whatsapp-templates')
    for (const language of ['en', 'ar'] as const) {
      const saved = response.data.templates?.[language] || {}
      for (const key of whatsappTemplateKeys) whatsappTemplates[language][key] = saved[key] || ''
    }
    cacheWhatsAppOverrides({
      en: Object.fromEntries(Object.entries(whatsappTemplates.en).filter(([, value]) => value)),
      ar: Object.fromEntries(Object.entries(whatsappTemplates.ar).filter(([, value]) => value))
    })
  } catch {
    // Built-in templates remain available when overrides cannot be loaded.
  }
}

async function onSaveWhatsappTemplates(): Promise<void> {
  whatsappSaving.value = true
  whatsappMessage.value = ''
  try {
    const templates: Record<'en' | 'ar', Record<string, string>> = { en: {}, ar: {} }
    for (const language of ['en', 'ar'] as const) {
      for (const key of whatsappTemplateKeys) {
        const value = (whatsappTemplates[language][key] || '').trim()
        if (value) templates[language][key] = value
      }
    }
    const response = await apiPatch<WhatsAppTemplatesResponse>('/settings/whatsapp-templates', { templates })
    cacheWhatsAppOverrides(response.data.templates)
    whatsappMessage.value = store.isArabic ? 'تم حفظ القوالب.' : 'Templates saved.'
  } catch (e) {
    whatsappMessage.value = errorMessage(e)
  } finally {
    whatsappSaving.value = false
  }
}

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

function webhookReport(text: string, failed: boolean): void {
  webhookMessage.value = text
  webhookError.value = failed
}

async function loadWebhooks(): Promise<void> {
  try {
    const [endpoints, deliveries] = await Promise.all([
      apiGet<WebhookEndpointList>('/webhooks/endpoints'),
      apiGet<WebhookDeliveryList>('/webhooks/deliveries?limit=50')
    ])
    webhookEndpoints.value = endpoints.data.data
    webhookDeliveries.value = deliveries.data.data
  } catch (e) {
    webhookReport(errorMessage(e), true)
  }
}

async function onCreateWebhook(): Promise<void> {
  webhookSaving.value = true
  webhookReport('', false)
  try {
    if (!webhookForm.events.length) {
      throw new Error(store.isArabic ? 'اختر حدثًا واحدًا على الأقل.' : 'Select at least one event.')
    }
    const created = await apiPost<WebhookEndpointCreated>('/webhooks/endpoints', {
      url: webhookForm.url,
      events: webhookForm.events,
      isActive: webhookForm.isActive
    })
    webhookSecretOnce.value = created.data.secret
    webhookForm.url = ''
    webhookForm.events = []
    webhookForm.isActive = true
    webhookReport(store.isArabic ? 'تمت إضافة نقطة النهاية.' : 'Webhook endpoint added.', false)
    await loadWebhooks()
  } catch (e) {
    webhookReport(errorMessage(e), true)
  } finally {
    webhookSaving.value = false
  }
}

async function onToggleEndpoint(endpoint: WebhookEndpoint): Promise<void> {
  webhookSaving.value = true
  webhookReport('', false)
  try {
    await apiPatch(`/webhooks/endpoints/${endpoint.id}`, { isActive: !endpoint.isActive })
    webhookReport(store.isArabic ? 'تم تحديث نقطة النهاية.' : 'Webhook endpoint updated.', false)
    await loadWebhooks()
  } catch (e) {
    webhookReport(errorMessage(e), true)
  } finally {
    webhookSaving.value = false
  }
}

async function onRetryDelivery(delivery: WebhookDelivery): Promise<void> {
  webhookSaving.value = true
  webhookReport('', false)
  try {
    await apiPost(`/webhooks/deliveries/${delivery.id}/retry`, {})
    webhookReport(store.isArabic ? 'تمت إعادة إرسال التسليم.' : 'Delivery retried.', false)
    await loadWebhooks()
  } catch (e) {
    webhookReport(errorMessage(e), true)
  } finally {
    webhookSaving.value = false
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
.whatsapp-grid { grid-template-columns: repeat(2, minmax(260px, 1fr)); }
.whatsapp-grid textarea { font-family: inherit; resize: vertical; }
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
.webhook-form { align-items: end; }
.field-label { font-size: 0.8rem; color: #374151; }
.event-grid { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
.event-choice { flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.82rem; }
.event-choice input { width: auto; }
.webhook-table { min-width: 760px; }
.webhook-table code { font-size: 0.78rem; word-break: break-all; }
.status-badge { display: inline-block; border-radius: 999px; padding: 0.1rem 0.45rem; font-size: 0.68rem; background: #f3f4f6; color: #374151; }
.status-badge.on, .status-badge.success { background: #dcfce7; color: #166534; }
.status-badge.failed { background: #fef2f2; color: #991b1b; }
.status-badge.retrying, .status-badge.pending { background: #fef9c3; color: #854d0e; }
.status-badge.off { background: #f3f4f6; color: #6b7280; }
.delivery-error { margin-inline-start: 0.3rem; color: #b91c1c; font-weight: 700; }
.btn-small { padding: 0.35rem 0.7rem; font-size: 0.78rem; }
.secret-once { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 1rem; padding: 0.7rem 0.8rem; border: 1px dashed #a5b4fc; border-radius: 8px; background: #eef2ff; font-size: 0.82rem; }
.secret-once code { word-break: break-all; }
@media (max-width: 640px) {
  .event-grid { flex-direction: column; }
  .webhook-form .btn { width: 100%; }
}
</style>
