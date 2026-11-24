<template>
  <div class="page">
    <router-link to="/deals" class="back">{{ store.isArabic ? '→' : '←' }} {{ store.isArabic ? 'العودة للصفقات' : 'Back to deals' }}</router-link>

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
          <button class="btn btn-quiet no-print" type="button" @click="onPrint">
            <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة / حفظ PDF' : 'Print / PDF' }}
          </button>
          <select v-if="canEdit" :value="deal.status" @change="onStatusChange">
            <option v-for="status in statusOptions" :key="status" :value="status">{{ label(status) }}</option>
          </select>
          <span v-else class="status-pill" :class="statusClass(deal.status)">{{ label(deal.status) }}</span>
        </div>
      </header>

      <div class="print-only print-brand">
        <div class="print-brand-top">
          <strong>EstateOS</strong>
          <span>{{ printGeneratedAt }}</span>
        </div>
        <h1>{{ deal.property?.title || deal.propertyId }}</h1>
        <p>{{ label(deal.type) }} · {{ deal.property?.city || '—' }} · {{ deal.referenceNumber || deal.id }}</p>
      </div>

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

      <ClientPortalPanel entity-type="Deal" :entity-id="deal.id" />

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'قائمة الإغلاق' : 'Closing checklist' }}</h2>
          <span class="tag" v-if="checklist">
            {{ checklist.completed }}/{{ checklist.total }}
          </span>
        </div>
        <div v-if="!checklist?.items.length" class="empty">
          {{ store.isArabic ? 'لا توجد عناصر في القائمة.' : 'No checklist items yet.' }}
        </div>
        <div v-else class="list">
          <div v-for="item in checklist.items" :key="item.id" class="list-row">
            <label class="check-item">
              <input
                type="checkbox"
                :checked="item.isCompleted"
                :disabled="!canEdit || checklistSaving === item.itemKey || deal.status === 'COMPLETED'"
                @change="onChecklistToggle(item, $event)"
              />
              <span>{{ checklistLabel(item) }}</span>
            </label>
            <small v-if="item.completedAt" class="muted">{{ formatDate(item.completedAt) }}</small>
          </div>
        </div>
        <div v-if="checklist && !checklist.isComplete && deal.status !== 'COMPLETED' && canEdit" class="checklist-override">
          <label>
            <span>{{ store.isArabic ? 'سبب التجاوز (للمديرين فقط)' : 'Override reason (ADMIN/MANAGER only)' }}</span>
            <input v-model="overrideReason" maxlength="1000" :placeholder="store.isArabic ? 'اشرح سبب الإغلاق قبل اكتمال القائمة' : 'Explain why closing before the checklist is complete'" />
          </label>
          <p class="hint">
            {{ store.isArabic
              ? 'لا يمكن إكمال الصفقة قبل اكتمال القائمة إلا بسبب مكتوب من مدير أو مدير عام.'
              : 'A deal cannot move to Completed until every item is checked, unless management records a reason.' }}
          </p>
        </div>
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
          <h2>{{ store.isArabic ? 'حاسبة الأقساط وإنشاء الجدول' : 'Installment calculator & generator' }}</h2>
          <form class="form-grid" @submit.prevent="generateInstallments">
            <label>
              <span>{{ store.isArabic ? 'الدفعة المقدمة' : 'Down payment' }}</span>
              <input v-model="installmentForm.downPayment" type="number" min="0" step="0.01" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'عدد الأقساط' : 'Installment count' }}</span>
              <input v-model="installmentForm.installmentCount" type="number" min="1" max="120" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'التكرار' : 'Frequency' }}</span>
              <select v-model="installmentForm.frequency">
                <option v-for="frequency in INSTALLMENT_FREQUENCIES" :key="frequency" :value="frequency">
                  {{ label(frequency) }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ store.isArabic ? 'تاريخ أول استحقاق' : 'First due date' }}</span>
              <input v-model="installmentForm.firstDueDate" type="date" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'مفتاح الدفعة (اختياري)' : 'Batch key (optional)' }}</span>
              <input v-model="installmentForm.batchKey" />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="installmentBusy || !installmentPreview">
              {{ installmentBusy ? '…' : (store.isArabic ? 'إنشاء الجدول' : 'Generate schedule') }}
            </button>
          </form>

          <div v-if="installmentWarning" class="installment-warning" role="alert">{{ installmentWarning }}</div>
          <div v-if="installmentError" class="error" role="alert">{{ installmentError }}</div>
          <div v-if="actionMessage" class="notice" role="status">{{ actionMessage }}</div>

          <template v-if="installmentPreview">
            <div class="summary">
              <div>
                <span>{{ store.isArabic ? 'المبلغ الممول' : 'Financed amount' }}</span>
                <strong>{{ money(installmentPreview.financedAmount, deal.currency) }}</strong>
              </div>
              <div>
                <span>{{ store.isArabic ? 'عدد الأقساط' : 'Installments' }}</span>
                <strong>{{ installmentPreview.installmentCount }}</strong>
              </div>
              <div>
                <span>{{ store.isArabic ? 'الإجمالي' : 'Total' }}</span>
                <strong>{{ money(installmentPreview.total, deal.currency) }}</strong>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th>
                    <th>{{ store.isArabic ? 'تاريخ الاستحقاق' : 'Due date' }}</th>
                    <th class="no-print">{{ store.isArabic ? 'واتساب' : 'WhatsApp' }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in installmentPreview.installments" :key="row.index">
                    <td>{{ row.index }}</td>
                    <td>{{ money(row.amount, deal.currency) }}</td>
                    <td>{{ installmentDate(row.dueAt) }}</td>
                    <td class="no-print">
                      <button type="button" class="link whatsapp-link" @click="whatsappForInstallment(row)">
                        <i class="fab fa-whatsapp"></i> {{ store.isArabic ? 'تذكير' : 'Remind' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>

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
              <span>{{ store.isArabic ? 'تاريخ الاستحقاق' : 'Due date' }}</span>
              <input v-model="paymentForm.dueAt" type="date" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'تاريخ الدفع' : 'Paid at' }}</span>
              <input v-model="paymentForm.paidAt" type="date" />
            </label>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ store.isArabic ? 'تسجيل الدفعة' : 'Record payment' }}</button>
          </form>

          <div v-if="!deal.payments?.length" class="empty">{{ store.isArabic ? 'لا توجد دفعات.' : 'No payments recorded.' }}</div>
          <table v-else>
            <thead><tr><th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th><th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th><th>{{ store.isArabic ? 'الفئة العمرية' : 'Aging' }}</th><th>{{ store.isArabic ? 'الطريقة' : 'Method' }}</th><th>{{ store.isArabic ? 'التاريخ' : 'Date' }}</th><th>{{ store.isArabic ? 'الاستحقاق' : 'Due date' }}</th></tr></thead>
            <tbody>
              <tr v-for="payment in paymentsWithDueAt" :key="payment.id">
                <td>{{ money(payment.amount, payment.currency) }}</td>
                <td>{{ label(payment.status) }}</td>
                <td><span class="aging-pill" :class="`aging-${payment.aging?.bucket || 'CURRENT'}`">{{ agingLabel(payment.aging?.bucket || 'CURRENT') }}</span></td>
                <td>{{ payment.method || '—' }}</td>
                <td>{{ formatDate(payment.paidAt || payment.createdAt) }}</td>
                <td>{{ formatDate(payment.dueAt) }}</td>
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
          <router-link to="/documents">{{ store.isArabic ? 'إدارة الوثائق' : 'Manage documents' }} {{ store.isArabic ? '←' : '→' }}</router-link>
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
import ClientPortalPanel from '@/components/ClientPortalPanel.vue'
import { dealTransitions } from '@/config/resources'
import { downloadDocument } from '@/utils/documents'
import {
  INSTALLMENT_FREQUENCIES,
  previewInstallments,
  type InstallmentFrequency
} from '@/utils/installments'
import { daysUntilLeaseEnd, leaseRenewalState, type LeaseRenewalState } from '@/utils/leases'
import { agingLabel } from '@/utils/paymentAging'
import { openWhatsAppChat } from '@/utils/whatsapp'
import { useStore } from '@/stores'
import type {
  Deal,
  DealChecklistItem,
  DealChecklistProgress,
  MoneyValue,
  Payment,
  PaymentSummary
} from '@/types'

type PaymentWithDueAt = Payment & { dueAt?: string | null }

const store = useStore()
const route = useRoute()
const printGeneratedAt = computed(() => new Date().toLocaleString(store.isArabic ? 'ar' : 'en'))
const deal = ref<Deal | null>(null)
const summary = ref<PaymentSummary | null>(null)
const checklist = ref<DealChecklistProgress | null>(null)
const checklistSaving = ref<string | null>(null)
const overrideReason = ref('')
const loading = ref(true)
const saving = ref(false)
const actionError = ref('')
const actionMessage = ref('')
const installmentBusy = ref(false)
const installmentError = ref('')

const paymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']
const commissionStatuses = ['PENDING', 'APPROVED', 'PAID', 'CANCELLED']

const paymentForm = reactive({
  amount: '',
  currency: '',
  exchangeRate: '',
  status: 'PENDING',
  method: '',
  reference: '',
  dueAt: '',
  paidAt: ''
})

const commissionForm = reactive({ amount: '', currency: '', rate: '' })
const leaseForm = reactive({ leaseStartAt: '', leaseEndAt: '', renewalNoticeDays: '30' })
const installmentForm = reactive({
  downPayment: '',
  installmentCount: '',
  frequency: 'MONTHLY' as InstallmentFrequency,
  firstDueDate: '',
  batchKey: ''
})

const paymentsWithDueAt = computed<PaymentWithDueAt[]>(() => (deal.value?.payments ?? []) as PaymentWithDueAt[])

const installmentState = computed(() => {
  if (!deal.value || !installmentForm.installmentCount) return { preview: null, warning: '' }
  const down = Number(installmentForm.downPayment || 0)
  const amount = Number(deal.value.amount || 0)
  if (!Number.isFinite(down) || down < 0) {
    return { preview: null, warning: store.isArabic ? 'أدخل مبلغ دفعة مقدمة صالحاً.' : 'Enter a valid down payment.' }
  }
  if (down > amount) {
    return { preview: null, warning: store.isArabic ? 'لا يمكن أن تتجاوز الدفعة المقدمة مبلغ الصفقة.' : 'Down payment cannot exceed the deal amount.' }
  }
  try {
    const preview = previewInstallments({
      dealAmount: deal.value.amount,
      downPayment: installmentForm.downPayment || 0,
      installmentCount: installmentForm.installmentCount,
      frequency: installmentForm.frequency,
      firstDueDate: installmentForm.firstDueDate
    })
    return { preview, warning: '' }
  } catch (error) {
    return { preview: null, warning: error instanceof Error ? error.message : (store.isArabic ? 'بيانات الأقساط غير صالحة.' : 'Invalid installment details.') }
  }
})
const installmentPreview = computed(() => installmentState.value.preview)
const installmentWarning = computed(() => installmentState.value.warning)

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

const CHECKLIST_LABELS: Record<string, [string, string]> = {
  PAYMENT_SETTLED: ['Payment settled', 'تم تسوية الدفعات'],
  DOCUMENTS_COMPLETE: ['Documents complete', 'الوثائق مكتملة'],
  CONTRACT_SIGNED: ['Contract signed', 'العقد موقّع'],
  HANDOVER_CONFIRMED: ['Handover confirmed', 'تم تأكيد التسليم']
}

function checklistLabel(item: DealChecklistItem): string {
  const pair = CHECKLIST_LABELS[item.itemKey]
  return pair ? (store.isArabic ? pair[1] : pair[0]) : item.label
}

async function loadChecklist(id: string): Promise<void> {
  try {
    checklist.value = (await apiGet<DealChecklistProgress>(`/deals/${id}/checklist`)).data
  } catch {
    checklist.value = null
  }
}

async function onChecklistToggle(item: DealChecklistItem, event: Event): Promise<void> {
  if (!deal.value) return
  const completed = (event.target as HTMLInputElement).checked
  checklistSaving.value = item.itemKey
  actionError.value = ''
  try {
    const response = await apiPatch<{ progress: DealChecklistProgress }>(
      `/deals/${deal.value.id}/checklist/${item.itemKey}`,
      { completed }
    )
    checklist.value = response.data.progress
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    checklistSaving.value = null
  }
}

function onPrint(): void {
  window.print()
}

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  actionError.value = ''
  const id = String(route.params.id || '')
  try {
    const response = await apiGet<Deal>(`/deals/${id}`)
    deal.value = response.data
    if (!installmentForm.firstDueDate) {
      installmentForm.firstDueDate = response.data.dueAt
        ? String(response.data.dueAt).slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    }
    paymentForm.currency = response.data.currency || ''
    commissionForm.currency = response.data.currency || ''
    leaseForm.leaseStartAt = response.data.leaseStartAt ? String(response.data.leaseStartAt).slice(0, 10) : ''
    leaseForm.leaseEndAt = response.data.leaseEndAt ? String(response.data.leaseEndAt).slice(0, 10) : ''
    leaseForm.renewalNoticeDays = String(response.data.renewalNoticeDays ?? 30)
    await loadChecklist(id)
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

const VALUE_LABELS: Record<string, [string, string]> = {
  DRAFT: ['Draft', 'مسودة'],
  PENDING: ['Pending', 'قيد الانتظار'],
  ACTIVE: ['Active', 'نشطة'],
  COMPLETED: ['Completed', 'مكتملة'],
  CANCELLED: ['Cancelled', 'ملغية'],
  APPROVED: ['Approved', 'معتمدة'],
  PAID: ['Paid', 'مدفوعة'],
  FAILED: ['Failed', 'فاشلة'],
  REFUNDED: ['Refunded', 'مستردة'],
  SALE: ['Sale', 'بيع'],
  RENT: ['Rent', 'إيجار'],
  MONTHLY: ['Monthly', 'شهري'],
  QUARTERLY: ['Quarterly', 'ربع سنوي'],
  SEMI_ANNUAL: ['Semi-annual', 'نصف سنوي'],
  ANNUAL: ['Annual', 'سنوي']
}

function label(value: string): string {
  const pair = VALUE_LABELS[value]
  if (pair) return store.isArabic ? pair[1] : pair[0]
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(store.isArabic ? 'ar' : 'en')
}

function installmentDate(value: string): string {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(store.isArabic ? 'ar' : 'en', dateOnly ? { timeZone: 'UTC' } : undefined)
}

async function whatsappForInstallment(row: { index: number; amount: string; dueAt: string }): Promise<void> {
  const current = deal.value
  if (!current) return
  let lead: { phone?: string | null; firstName?: string | null; lastName?: string | null } | null = null
  if (current.leadId) {
    try {
      const response = await apiGet<typeof lead>(`/leads/${encodeURIComponent(current.leadId)}`)
      lead = response.data
    } catch {
      lead = null
    }
  }
  const rows = installmentPreview.value?.installments || []
  const remaining = rows
    .filter((item) => item.index <= row.index)
    .reduce((total, item) => total + Number(item.amount || 0), 0)
  const opened = openWhatsAppChat({
    phone: lead?.phone,
    template: 'installmentReminder',
    payload: {
      customerName: [lead?.firstName, lead?.lastName].filter(Boolean).join(' '),
      reference: current.referenceNumber,
      dueDate: row.dueAt,
      amount: row.amount,
      remainingBalance: String(remaining),
      currency: current.currency
    },
    language: store.isArabic ? 'ar' : 'en'
  })
  if (!opened) {
    actionError.value = store.isArabic ? 'لا يوجد رقم واتساب صالح للعميل.' : 'No valid WhatsApp number for the lead on this deal.'
  }
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
    const payload: Record<string, unknown> = { status }
    if (status === 'COMPLETED' && checklist.value && !checklist.value.isComplete && overrideReason.value.trim()) {
      payload.checklistOverrideReason = overrideReason.value.trim()
    }
    await apiPatch(`/deals/${deal.value.id}`, payload)
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
      dueAt: paymentForm.dueAt || undefined,
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

async function generateInstallments(): Promise<void> {
  if (!deal.value || !installmentPreview.value) return
  installmentBusy.value = true
  installmentError.value = ''
  actionMessage.value = ''
  try {
    const payload: Record<string, unknown> = {
      downPayment: installmentForm.downPayment || 0,
      installmentCount: Number(installmentForm.installmentCount),
      frequency: installmentForm.frequency,
      firstDueDate: installmentForm.firstDueDate
    }
    if (installmentForm.batchKey.trim()) payload.batchKey = installmentForm.batchKey.trim()
    const response = await apiPost<{ payments?: Array<{ id: string }>; installmentCount?: number }>(
      `/deals/${deal.value.id}/installments`,
      payload
    )
    const count = response.data?.installmentCount ?? response.data?.payments?.length ?? 0
    actionMessage.value = store.isArabic
      ? `تم إنشاء ${count} قسط.`
      : `Generated ${count} installment(s).`
    await load()
  } catch (error) {
    installmentError.value = errorMessage(error)
  } finally {
    installmentBusy.value = false
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
.hero-actions { display: flex; flex-direction: column; align-items: end; gap: 0.4rem; }
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
.list-row { display: flex; align-items: center; gap: 0.8rem; padding: 0.6rem 0; border-block-end: 1px solid #f3f4f6; font-size: 0.86rem; }
.list-row span:first-child { flex: 1; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; }
.whatsapp-link { color: #128c7e; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
th, td { text-align: start; padding: 0.55rem 0.6rem; border-block-end: 1px solid #f3f4f6; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.empty, .state { padding: 1.2rem; text-align: center; color: #6b7280; font-size: 0.88rem; background: #f9fafb; border-radius: 8px; }
.timeline { list-style: none; padding: 0; margin: 0; }
.timeline li { padding: 0.6rem 0 0.6rem 1rem; border-inline-start: 2px solid #c7d2fe; font-size: 0.86rem; }
.timeline li span { color: #6b7280; font-size: 0.76rem; margin-inline-start: 0.6rem; }
.timeline li p { margin: 0.2rem 0 0; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.65rem 0.8rem; font-size: 0.85rem; }
.installment-warning { background: #fffbeb; color: #92400e; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.84rem; margin-bottom: 0.8rem; }
.notice { background: #ecfdf5; color: #166534; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.84rem; margin-bottom: 0.8rem; }
.check-item { display: flex; flex-direction: row; align-items: center; gap: 0.6rem; flex: 1; font-size: 0.88rem; color: #374151; }
.check-item input { width: 1rem; height: 1rem; }
.checklist-override { margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid #f3f4f6; }
.checklist-override label { max-width: 520px; }
.hint { font-size: 0.76rem; color: #6b7280; margin: 0.45rem 0 0; }
.aging-pill { font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 999px; background: #f3f4f6; color: #4b5563; white-space: nowrap; }
.aging-1_30_DAYS { background: #fef3c7; color: #92400e; }
.aging-31_60_DAYS { background: #ffedd5; color: #9a3412; }
.aging-60_PLUS_DAYS { background: #fee2e2; color: #991b1b; }
.aging-PAID { background: #dcfce7; color: #166534; }
.table-wrap { max-height: 260px; overflow: auto; overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 8px; margin-top: 0.8rem; }
.table-wrap th { position: sticky; top: 0; background: #f9fafb; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
@media (max-width: 768px) {
  .table-wrap { overflow-x: auto; }
  table { min-width: 520px; }
  .btn, input, select { min-height: 44px; }
  .hero-actions, .panel-head { align-items: flex-start; flex-wrap: wrap; }
}
@media (max-width: 768px) {
  .table-wrap { overflow-x: auto; }
  .btn { min-height: 44px; }
  .panel, .card { padding-inline: 0.75rem; }
}
</style>
