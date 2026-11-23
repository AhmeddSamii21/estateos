<template>
  <div class="page">
    <router-link to="/deals" class="back">← {{ store.isArabic ? 'العودة للصفقات' : 'Back to deals' }}</router-link>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!deal" class="state">{{ store.isArabic ? 'الصفقة غير موجودة.' : 'Deal not found.' }}</div>

    <template v-else>
      <header class="hero">
        <div>
          <span class="badge">{{ deal.referenceNumber || deal.id }}</span>
          <h1>{{ deal.property?.title || deal.propertyId }}</h1>
          <p class="muted">
            {{ label(deal.type) }} · {{ deal.property?.city || '—' }} ·
            {{ store.isArabic ? 'المسؤول' : 'Responsible' }}: {{ deal.user?.firstName || deal.user?.email || '—' }}
          </p>
        </div>
        <div class="hero-actions">
          <strong>{{ money(deal.amount, deal.currency) }}</strong>
          <select v-if="canEdit" :value="deal.status" @change="onStatusChange">
            <option v-for="status in statusOptions" :key="status" :value="status">{{ label(status) }}</option>
          </select>
          <span v-else class="status-pill" :class="statusClass(deal.status)">{{ label(deal.status) }}</span>
        </div>
      </header>

      <div v-if="actionError" class="error" role="alert">{{ actionError }}</div>

      <section class="panel">
        <h2>{{ store.isArabic ? 'تفاصيل الصفقة' : 'Deal details' }}</h2>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'الحالة' : 'Status' }}</dt><dd>{{ label(deal.status) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'العميل' : 'Lead' }}</dt><dd>{{ leadName || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'بدأت' : 'Started' }}</dt><dd>{{ formatDate(deal.startedAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'موعد الاستحقاق' : 'Due' }}</dt><dd>{{ formatDate(deal.dueAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'أغلقت' : 'Closed' }}</dt><dd>{{ formatDate(deal.closedAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المبلغ الأساسي' : 'Base amount' }}</dt><dd>{{ formatBaseAmount(deal.baseAmount) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'سعر الصرف' : 'Exchange rate' }}</dt><dd>{{ deal.exchangeRate ?? '—' }}</dd></div>
        </dl>
        <p v-if="deal.notes" class="description">{{ deal.notes }}</p>
      </section>

      <section v-if="isRental" class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'عقد الإيجار والتجديد' : 'Lease & renewal' }}</h2>
          <span v-if="renewalState" class="lease-pill" :class="`lease-${renewalState}`">
            {{ leaseStateLabel(renewalState) }}
          </span>
        </div>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'بداية العقد' : 'Lease start' }}</dt><dd>{{ formatDate(deal.leaseStartAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'نهاية العقد' : 'Lease end' }}</dt><dd>{{ formatDate(deal.leaseEndAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'إشعار التجديد' : 'Renewal notice' }}</dt><dd>{{ deal.renewalNoticeDays ?? 30 }} {{ store.isArabic ? 'يوم' : 'days' }}</dd></div>
          <div v-if="daysLeft !== null">
            <dt>{{ store.isArabic ? 'الأيام المتبقية' : 'Days remaining' }}</dt>
            <dd :class="{ 'days-expired': daysLeft < 0 }">{{ daysLeft }}</dd>
          </div>
        </dl>
        <p v-if="renewalState" class="lease-note">
          {{ renewalMessage }}
        </p>
        <form v-if="canEdit" class="form-grid" @submit.prevent="saveLease">
          <label>
            <span>{{ store.isArabic ? 'بداية العقد' : 'Lease start' }}</span>
            <input v-model="leaseForm.leaseStartAt" type="date" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'نهاية العقد' : 'Lease end' }}</span>
            <input v-model="leaseForm.leaseEndAt" type="date" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'إشعار التجديد (أيام)' : 'Renewal notice (days)' }}</span>
            <input v-model="leaseForm.renewalNoticeDays" type="number" min="0" max="365" />
          </label>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ store.isArabic ? 'حفظ العقد' : 'Save lease' }}
          </button>
        </form>
      </section>

      <template v-if="store.canManageFinance">
        <section class="panel">
          <h2>{{ store.isArabic ? 'ملخص الدفعات' : 'Payment summary' }}</h2>
          <div v-if="summary" class="summary">
            <div><span>{{ store.isArabic ? 'المستلم' : 'Received' }}</span><strong>{{ money(summary.received, summary.currency) }}</strong></div>
            <div><span>{{ store.isArabic ? 'المتبقي' : 'Outstanding' }}</span><strong>{{ money(summary.outstanding, summary.currency) }}</strong></div>
            <div><span>{{ store.isArabic ? 'عدد الدفعات' : 'Payments' }}</span><strong>{{ summary.payments }}</strong></div>
          </div>

          <form class="form-grid" @submit.prevent="recordPayment">
            <label>
              <span>{{ store.isArabic ? 'المبلغ *' : 'Amount *' }}</span>
              <input v-model="paymentForm.amount" type="number" min="0.01" step="0.01" required />
            </label>
            <label>
              <span>{{ store.isArabic ? 'العملة' : 'Currency' }}</span>
              <input v-model="paymentForm.currency" maxlength="3" required />
            </label>
            <label>
              <span>{{ store.isArabic ? 'سعر الصرف' : 'Exchange rate' }}</span>
              <input v-model="paymentForm.exchangeRate" type="number" min="0" step="0.00000001" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
              <select v-model="paymentForm.status">
                <option v-for="status in paymentStatuses" :key="status" :value="status">{{ label(status) }}</option>
              </select>
            </label>
            <label>
              <span>{{ store.isArabic ? 'الطريقة' : 'Method' }}</span>
              <input v-model="paymentForm.method" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'المرجع' : 'Reference' }}</span>
              <input v-model="paymentForm.reference" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'تاريخ الدفع' : 'Paid at' }}</span>
              <input v-model="paymentForm.paidAt" type="date" />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ store.isArabic ? 'تسجيل الدفعة' : 'Record payment' }}</button>
          </form>

          <div v-if="!deal.payments?.length" class="empty">{{ store.isArabic ? 'لا توجد دفعات.' : 'No payments recorded.' }}</div>
          <table v-else>
            <thead><tr><th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th><th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th><th>{{ store.isArabic ? 'الطريقة' : 'Method' }}</th><th>{{ store.isArabic ? 'التاريخ' : 'Date' }}</th></tr></thead>
            <tbody>
              <tr v-for="payment in deal.payments" :key="payment.id">
                <td>{{ money(payment.amount, payment.currency) }}</td>
                <td>{{ label(payment.status) }}</td>
                <td>{{ payment.method || '—' }}</td>
                <td>{{ formatDate(payment.paidAt || payment.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>{{ store.isArabic ? 'العمولات' : 'Commissions' }}</h2>
          <form class="form-grid" @submit.prevent="configureCommission">
            <label>
              <span>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</span>
              <input v-model="commissionForm.amount" type="number" min="0" step="0.01" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'النسبة' : 'Rate' }}</span>
              <input v-model="commissionForm.rate" type="number" min="0" step="0.0001" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'العملة' : 'Currency' }}</span>
              <input v-model="commissionForm.currency" maxlength="3" required />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ store.isArabic ? 'إضافة عمولة' : 'Add commission' }}</button>
          </form>
          <div v-if="!deal.commissions?.length" class="empty">{{ store.isArabic ? 'لا توجد عمولات.' : 'No commissions configured.' }}</div>
          <div v-else class="list">
            <div v-for="commission in deal.commissions" :key="commission.id" class="list-row">
              <span>{{ money(commission.amount, commission.currency) }} · {{ label(commission.status) }}</span>
              <select v-if="commission.status !== 'PAID' && commission.status !== 'CANCELLED'" :value="commission.status" @change="onCommissionStatus(commission.id, $event)">
                <option v-for="status in commissionStatuses" :key="status" :value="status">{{ label(status) }}</option>
              </select>
            </div>
          </div>
        </section>
      </template>

      <section v-if="store.canManageFinance" class="panel">
        <h2>{{ store.isArabic ? 'المصروفات' : 'Expenses' }}</h2>
        <div v-if="!deal.expenses?.length" class="empty">{{ store.isArabic ? 'لا توجد مصروفات.' : 'No expenses recorded.' }}</div>
        <div v-else class="list">
          <div v-for="expense in deal.expenses" :key="expense.id" class="list-row">
            <span>{{ expense.category }} · {{ money(expense.amount, expense.currency) }}</span>
            <span class="tag">{{ label(expense.status) }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'الوثائق' : 'Documents' }}</h2>
          <router-link to="/documents">{{ store.isArabic ? 'إدارة الوثائق' : 'Manage documents' }} →</router-link>
        </div>
        <div v-if="!deal.documents?.length" class="empty">{{ store.isArabic ? 'لا توجد وثائق.' : 'No documents linked.' }}</div>
        <div v-else class="list">
          <div v-for="document in deal.documents" :key="document.id" class="list-row">
            <span><i class="fas fa-file"></i> {{ document.name }}</span>
            <button type="button" class="link" @click="onDownload(document.id, document.originalName)">
              {{ store.isArabic ? 'تنزيل' : 'Download' }}
            </button>
          </div>
        </div>
      </section>

      <ActivityTimeline entity-type="Deal" :entity-id="deal.id" :limit="10" :show-filters="false" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import { dealTransitions } from '@/config/resources'
import { downloadDocument } from '@/utils/documents'
import { daysUntilLeaseEnd, leaseRenewalState, type LeaseRenewalState } from '@/utils/leases'
import { useStore } from '@/stores'
import type { Deal, MoneyValue, PaymentSummary } from '@/types'

const store = useStore()
const route = useRoute()
const deal = ref<Deal | null>(null)
const summary = ref<PaymentSummary | null>(null)
const loading = ref(true)
const saving = ref(false)
const actionError = ref('')

const paymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']
const commissionStatuses = ['PENDING', 'APPROVED', 'PAID', 'CANCELLED']

const paymentForm = reactive({
  amount: '',
  currency: '',
  exchangeRate: '',
  status: 'PENDING',
  method: '',
  reference: '',
  paidAt: ''
})

const commissionForm = reactive({ amount: '', currency: '', rate: '' })
const leaseForm = reactive({ leaseStartAt: '', leaseEndAt: '', renewalNoticeDays: '30' })

const canEdit = computed(() => store.canManage || Boolean(store.user && deal.value && deal.value.userId === store.user.id))
const isRental = computed(() => deal.value?.type === 'RENT')
const renewalState = computed<LeaseRenewalState | null>(() =>
  deal.value ? leaseRenewalState(deal.value) : null
)
const daysLeft = computed(() => deal.value?.leaseEndAt ? daysUntilLeaseEnd(deal.value.leaseEndAt) : null)
const renewalMessage = computed(() => {
  if (!deal.value || !renewalState.value || daysLeft.value === null) return ''
  const days = daysLeft.value
  if (renewalState.value === 'expired') {
    return store.isArabic
      ? `انتهى هذا العقد قبل ${Math.abs(days)} يوم. جدّده أو أغلق الصفقة.`
      : `This lease expired ${Math.abs(days)} day(s) ago. Renew it or close the deal.`
  }
  const notice = deal.value.renewalNoticeDays ?? 30
  return store.isArabic
    ? `يتبقى ${days} يوم على نهاية العقد، ضمن نافذة الإشعار البالغة ${notice} يوماً.`
    : `${days} day(s) until lease end, inside the ${notice}-day notice window.`
})
const canViewFinance = computed(() => store.canManageFinance)
const leadName = computed(() => {
  const lead = deal.value?.lead
  return lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : ''
})
// Include the current stage so the select always displays it, then offer only
// the forward moves the API accepts.
const statusOptions = computed(() => {
  const current = deal.value?.status || ''
  return Array.from(new Set([current, ...(dealTransitions[current] || [])].filter(Boolean)))
})

function statusClass(status: string): string {
  return `status-${status.toLowerCase().replaceAll('_', '-')}`
}

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  actionError.value = ''
  const id = String(route.params.id || '')
  try {
    const response = await apiGet<Deal>(`/deals/${id}`)
    deal.value = response.data
    paymentForm.currency = response.data.currency || ''
    commissionForm.currency = response.data.currency || ''
    leaseForm.leaseStartAt = response.data.leaseStartAt ? String(response.data.leaseStartAt).slice(0, 10) : ''
    leaseForm.leaseEndAt = response.data.leaseEndAt ? String(response.data.leaseEndAt).slice(0, 10) : ''
    leaseForm.renewalNoticeDays = String(response.data.renewalNoticeDays ?? 30)
    if (canViewFinance.value) {
      const summaryResponse = await apiGet<PaymentSummary>('/finance/payments/summary', { params: { dealId: id } })
      summary.value = summaryResponse.data
    }
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function label(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function money(amount: MoneyValue | null | undefined, currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase()
  if (!code) return `${amount || 0} UNSPECIFIED`
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: code
    }).format(Number(amount || 0))
  } catch {
    return `${amount || 0} ${code}`
  }
}

function leaseStateLabel(state: LeaseRenewalState): string {
  const labels: Record<LeaseRenewalState, [string, string]> = {
    expired: ['Expired', 'منتهي'],
    due: ['Renewal due', 'تجديد مستحق'],
    upcoming: ['Upcoming', 'قادم']
  }
  return store.isArabic ? labels[state][1] : labels[state][0]
}

async function saveLease(): Promise<void> {
  if (!deal.value) return
  saving.value = true
  actionError.value = ''
  try {
    await apiPatch(`/deals/${deal.value.id}`, {
      leaseStartAt: leaseForm.leaseStartAt || null,
      leaseEndAt: leaseForm.leaseEndAt || null,
      renewalNoticeDays: Number(leaseForm.renewalNoticeDays)
    })
    await load()
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

function formatBaseAmount(amount: MoneyValue | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const formatted = new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0))
  return `${formatted} ${store.isArabic ? 'عملة أساسية' : 'base currency'}`
}

async function onStatusChange(event: Event): Promise<void> {
  if (!deal.value) return
  const status = (event.target as HTMLSelectElement).value
  try {
    await apiPatch(`/deals/${deal.value.id}`, { status })
    await load()
  } catch (error) {
    actionError.value = errorMessage(error)
  }
}

async function recordPayment(): Promise<void> {
  if (!deal.value) return
  saving.value = true
  actionError.value = ''
  try {
    await apiPost('/finance/payments', {
      dealId: deal.value.id,
      amount: paymentForm.amount,
      currency: paymentForm.currency,
      exchangeRate: paymentForm.exchangeRate || undefined,
      status: paymentForm.status,
      method: paymentForm.method || undefined,
      reference: paymentForm.reference || undefined,
      paidAt: paymentForm.paidAt || undefined
    })
    paymentForm.amount = ''
    paymentForm.reference = ''
    paymentForm.method = ''
    await load()
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function configureCommission(): Promise<void> {
  if (!deal.value) return
  saving.value = true
  actionError.value = ''
  try {
    await apiPost('/finance/commissions', {
      dealId: deal.value.id,
      amount: commissionForm.amount || undefined,
      currency: commissionForm.currency,
      rate: commissionForm.rate || undefined
    })
    commissionForm.amount = ''
    commissionForm.rate = ''
    await load()
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function onCommissionStatus(id: string, event: Event): Promise<void> {
  const status = (event.target as HTMLSelectElement).value
  try {
    await apiPatch(`/finance/commissions/${id}`, { status })
    await load()
  } catch (error) {
    actionError.value = errorMessage(error)
  }
}

async function onDownload(id: string, name: string): Promise<void> {
  try {
    await downloadDocument(id, name)
  } catch (error) {
    actionError.value = errorMessage(error)
  }
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.back { color: #4f46e5; text-decoration: none; font-size: 0.88rem; }
.hero { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; }
h1 { margin: 0.5rem 0 0.2rem; font-size: 1.5rem; }
h2 { font-size: 1.05rem; margin: 0 0 0.9rem; }
.muted { color: #6b7280; margin: 0; font-size: 0.86rem; }
.hero-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem; }
.hero-actions strong { font-size: 1.5rem; color: #4338ca; }
.badge, .tag, .status-pill { font-size: 0.7rem; color: #3730a3; background: #e0e7ff; padding: 0.2rem 0.6rem; border-radius: 999px; }
.status-draft { background: #f3f4f6; color: #4b5563; }
.status-pending { background: #fef3c7; color: #92400e; }
.status-active { background: #e0e7ff; color: #3730a3; }
.status-completed { background: #dcfce7; color: #166534; }
.status-cancelled { background: #fee2e2; color: #991b1b; }
.lease-pill { font-size: 0.7rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: #e0e7ff; color: #3730a3; }
.lease-expired { background: #fee2e2; color: #991b1b; }
.lease-due { background: #fef3c7; color: #92400e; }
.days-expired { color: #991b1b; }
.lease-note { font-size: 0.82rem; color: #4b5563; background: #f8fafc; border-radius: 8px; padding: 0.6rem 0.8rem; margin: 0 0 1rem; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.3rem; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
.panel-head a { color: #4f46e5; font-size: 0.82rem; text-decoration: none; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.9rem; margin: 0 0 0.8rem; }
.facts dt { font-size: 0.75rem; color: #6b7280; }
.facts dd { margin: 0.2rem 0 0; font-weight: 600; font-size: 0.92rem; }
.description { white-space: pre-wrap; color: #4b5563; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.8rem; margin-bottom: 1rem; }
.summary div { background: #f8fafc; border-radius: 8px; padding: 0.8rem; display: flex; flex-direction: column; }
.summary span { font-size: 0.74rem; color: #6b7280; }
.summary strong { color: #312e81; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; margin-bottom: 1rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; }
.btn { align-self: end; border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
.btn-primary { background: #4f46e5; color: #fff; }
.list { display: flex; flex-direction: column; }
.list-row { display: flex; align-items: center; gap: 0.8rem; padding: 0.6rem 0; border-bottom: 1px solid #f3f4f6; font-size: 0.86rem; }
.list-row span:first-child { flex: 1; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; }
table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
th, td { text-align: start; padding: 0.55rem 0.6rem; border-bottom: 1px solid #f3f4f6; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.empty, .state { padding: 1.2rem; text-align: center; color: #6b7280; font-size: 0.88rem; background: #f9fafb; border-radius: 8px; }
.timeline { list-style: none; padding: 0; margin: 0; }
.timeline li { padding: 0.6rem 0 0.6rem 1rem; border-inline-start: 2px solid #c7d2fe; font-size: 0.86rem; }
.timeline li span { color: #6b7280; font-size: 0.76rem; margin-inline-start: 0.6rem; }
.timeline li p { margin: 0.2rem 0 0; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.65rem 0.8rem; font-size: 0.85rem; }
</style>
