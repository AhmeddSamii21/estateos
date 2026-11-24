<template>
  <div class="page">
    <div class="print-only print-brand">
      <div class="print-brand-top">
        <strong>EstateOS</strong>
        <span>{{ printGeneratedAt }}</span>
      </div>
      <h1>{{ t('Payment & mortgage calculator', 'حاسبة الدفعات والتمويل') }}</h1>
      <p>{{ t('Bilingual amortization summary', 'ملخص جدول السداد باللغتين') }}</p>
    </div>

    <header class="hero no-print">
      <div>
        <span class="badge">{{ t('Finance simulator', 'محاكي مالي') }}</span>
        <h1>{{ t('Payment & mortgage calculator', 'حاسبة الدفعات والتمويل') }}</h1>
        <p class="muted">
          {{ t('Model down payments, markup, terms, and balloons before sharing a plan.', 'نمذج الدفعة المقدمة والهامش والمدة والدفعات الكبيرة قبل مشاركة الخطة.') }}
        </p>
      </div>
      <div class="hero-actions">
        <button class="btn btn-quiet no-print" type="button" @click="onPrint">
          <i class="fas fa-print"></i> {{ t('Print / PDF', 'طباعة / حفظ PDF') }}
        </button>
      </div>
    </header>

    <div class="calculator-grid">
      <section class="panel form-panel no-print">
        <h2>{{ t('Plan inputs', 'مدخلات الخطة') }}</h2>
        <div class="form-grid">
          <label>
            <span>{{ t('Property price', 'سعر العقار') }}</span>
            <input v-model="form.price" type="number" min="0" step="0.01" />
          </label>
          <label>
            <span>{{ t('Down payment mode', 'نوع الدفعة المقدمة') }}</span>
            <select v-model="form.downPaymentMode">
              <option value="PERCENT">{{ t('Percentage', 'نسبة مئوية') }}</option>
              <option value="AMOUNT">{{ t('Fixed amount', 'مبلغ ثابت') }}</option>
            </select>
          </label>
          <label v-if="form.downPaymentMode === 'PERCENT'">
            <span>{{ t('Down payment %', 'الدفعة المقدمة %') }}</span>
            <input v-model="form.downPaymentPercent" type="number" min="0" max="100" step="0.1" />
          </label>
          <label v-else>
            <span>{{ t('Down payment amount', 'مبلغ الدفعة المقدمة') }}</span>
            <input v-model="form.downPaymentAmount" type="number" min="0" step="0.01" />
          </label>
          <label>
            <span>{{ t('Term - years', 'المدة - سنوات') }}</span>
            <input v-model="form.termYears" type="number" min="0" max="10" step="1" />
          </label>
          <label>
            <span>{{ t('Term - months', 'المدة - أشهر') }}</span>
            <input v-model="form.termMonths" type="number" min="0" max="11" step="1" />
          </label>
          <label>
            <span>{{ t('Annual interest / markup %', 'الفائدة أو الهامش السنوي %') }}</span>
            <input v-model="form.annualRatePercent" type="number" min="0" max="100" step="0.01" />
          </label>
          <label>
            <span>{{ t('Rate method', 'طريقة حساب المعدل') }}</span>
            <select v-model="form.rateMode">
              <option value="AMORTIZED">{{ t('Amortized', 'متناقص') }}</option>
              <option value="FLAT">{{ t('Flat markup', 'هامش ثابت') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('Frequency', 'الدورية') }}</span>
            <select v-model="form.frequency">
              <option v-for="frequency in INSTALLMENT_FREQUENCIES" :key="frequency" :value="frequency">
                {{ frequencyLabel(frequency) }}
              </option>
            </select>
          </label>
          <label>
            <span>{{ t('First due date', 'تاريخ الاستحقاق الأول') }}</span>
            <input v-model="form.firstDueDate" type="date" />
          </label>
          <label>
            <span>{{ t('Currency', 'العملة') }}</span>
            <input v-model="form.currency" type="text" maxlength="8" />
          </label>
          <label>
            <span>{{ t('WhatsApp number', 'رقم واتساب') }}</span>
            <input v-model="form.phone" type="tel" :placeholder="t('e.g. 01000000000', 'مثال: 01000000000')" />
          </label>
        </div>

        <div class="balloon-head">
          <h3>{{ t('Balloon payments', 'الدفعات الكبيرة') }}</h3>
          <button class="btn btn-quiet" type="button" @click="addBalloon">
            <i class="fas fa-plus"></i> {{ t('Add balloon', 'إضافة دفعة') }}
          </button>
        </div>
        <p class="muted">
          {{ t('A balloon is an extra lump sum at a specific month. It never includes agent commissions or internal notes.', 'الدفعة الكبيرة مبلغ إضافي في شهر محدد، ولا تتضمن عمولات أو ملاحظات داخلية.') }}
        </p>
        <div v-if="form.balloons.length" class="balloon-list">
          <div v-for="(balloon, index) in form.balloons" :key="index" class="balloon-row">
            <label>
              <span>{{ t('Month', 'الشهر') }}</span>
              <input v-model="balloon.month" type="number" min="1" :max="plan?.termMonths || 120" step="1" />
            </label>
            <label>
              <span>{{ t('Amount', 'المبلغ') }}</span>
              <input v-model="balloon.amount" type="number" min="0" step="0.01" />
            </label>
            <button class="btn btn-quiet danger no-print" type="button" @click="removeBalloon(index)">
              {{ t('Remove', 'إزالة') }}
            </button>
          </div>
        </div>

        <p v-if="calculation.error" class="error" role="alert">{{ calculation.error }}</p>
      </section>

      <section v-if="plan" class="panel results-panel">
        <div class="panel-head">
          <h2>{{ t('Plan summary', 'ملخص الخطة') }}</h2>
          <span class="tag">{{ rateModeLabel(plan.rateMode) }}</span>
        </div>
        <div class="summary-cards">
          <div class="summary-card">
            <span>{{ t('Down payment', 'الدفعة المقدمة') }}</span>
            <strong>{{ money(plan.downPayment, plan.currency) }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t('Financed', 'المبلغ الممول') }}</span>
            <strong>{{ money(plan.financedAmount, plan.currency) }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t('Periodic payment', 'الدفعة الدورية') }}</span>
            <strong>{{ money(plan.periodicPayment, plan.currency) }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t('Interest / markup', 'الفائدة أو الهامش') }}</span>
            <strong>{{ money(plan.totalInterest, plan.currency) }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t('Balloons', 'الدفعات الكبيرة') }}</span>
            <strong>{{ money(plan.totalBalloons, plan.currency) }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t('Total paid', 'إجمالي المدفوع') }}</span>
            <strong>{{ money(plan.totalPaid, plan.currency) }}</strong>
          </div>
        </div>
        <p class="muted">
          {{ t('Periodic rate', 'المعدل الدوري') }}: {{ percent(plan.periodicRatePercent, store.isArabic) }} ·
          {{ t('Periods', 'الدفعات') }}: {{ plan.periodCount }} ·
          {{ frequencyLabel(plan.frequency) }}
        </p>

        <div class="result-actions no-print">
          <button class="btn btn-whatsapp" type="button" :disabled="!plan.rows.length" @click="onWhatsApp">
            <i class="fab fa-whatsapp"></i> {{ t('Send on WhatsApp', 'إرسال عبر واتساب') }}
          </button>
          <button class="btn btn-quiet" type="button" :disabled="!plan.rows.length" @click="copySummary">
            {{ t('Copy summary', 'نسخ الملخص') }}
          </button>
        </div>
        <p v-if="actionMessage" class="muted">{{ actionMessage }}</p>

        <h3>{{ t('Amortization schedule', 'جدول السداد') }}</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{{ t('Due date', 'تاريخ الاستحقاق') }}</th>
                <th>{{ t('Payment', 'الدفعة') }}</th>
                <th>{{ t('Interest', 'الفائدة') }}</th>
                <th>{{ t('Principal', 'أصل الدين') }}</th>
                <th>{{ t('Balloon', 'دفعة كبيرة') }}</th>
                <th>{{ t('Balance', 'الرصيد') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in plan.rows" :key="row.period">
                <td>{{ row.period }}</td>
                <td>{{ date(row.dueAt, store.isArabic) }}</td>
                <td>{{ money(row.payment, plan.currency) }}</td>
                <td>{{ money(row.interest, plan.currency) }}</td>
                <td>{{ money(row.principal, plan.currency) }}</td>
                <td>{{ money(row.balloon, plan.currency) }}</td>
                <td>{{ money(row.balance, plan.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="footnote">
          {{ t('The final row closes any rounding residue; the remaining balance is always zero.', 'يُغلق السطر الأخير أي فرق تقريب، ويظل الرصيد المتبقي صفراً دائماً.') }}
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useStore } from '@/stores'
import {
  INSTALLMENT_FREQUENCIES,
  calculatePaymentPlan,
  formatAmortizationDate,
  formatAmortizationMoney,
  formatAmortizationPercent,
  buildAmortizationSummaryText,
  openAmortizationWhatsApp
} from '@/utils/paymentCalculator'
import type { BalloonInput, InstallmentFrequency, PaymentPlanInput, RateMode } from '@/utils/paymentCalculator'

type DownPaymentMode = 'PERCENT' | 'AMOUNT'

const store = useStore()
const actionMessage = ref('')
const form = reactive<{
  price: string
  downPaymentMode: DownPaymentMode
  downPaymentPercent: string
  downPaymentAmount: string
  termYears: string
  termMonths: string
  annualRatePercent: string
  rateMode: RateMode
  frequency: InstallmentFrequency
  firstDueDate: string
  currency: string
  phone: string
  balloons: Array<{ month: string; amount: string }>
}>({
  price: '300000',
  downPaymentMode: 'PERCENT',
  downPaymentPercent: '20',
  downPaymentAmount: '',
  termYears: '5',
  termMonths: '0',
  annualRatePercent: '0',
  rateMode: 'AMORTIZED',
  frequency: 'MONTHLY',
  firstDueDate: new Date().toISOString().slice(0, 10),
  currency: 'USD',
  phone: '',
  balloons: []
})

const printGeneratedAt = computed(() => new Date().toLocaleString(store.isArabic ? 'ar' : 'en'))

const planInput = computed<PaymentPlanInput>(() => ({
  price: form.price,
  ...(form.downPaymentMode === 'PERCENT'
    ? { downPaymentPercent: form.downPaymentPercent }
    : { downPaymentAmount: form.downPaymentAmount }),
  termYears: form.termYears,
  termMonths: form.termMonths,
  annualRatePercent: form.annualRatePercent,
  rateMode: form.rateMode,
  frequency: form.frequency,
  firstDueDate: form.firstDueDate,
  currency: form.currency,
  language: store.isArabic ? 'ar' : 'en',
  balloons: form.balloons.map((balloon) => ({ month: balloon.month, amount: balloon.amount }))
}))

const calculation = computed(() => {
  try {
    return { plan: calculatePaymentPlan(planInput.value), error: '' }
  } catch (error) {
    return { plan: null, error: error instanceof Error ? error.message : String(error) }
  }
})
const plan = computed(() => calculation.value.plan)

function t(en: string, ar: string): string {
  return store.isArabic ? ar : en
}

function money(value: string | number | null | undefined, currency: string | null | undefined): string {
  return formatAmortizationMoney(value, currency || form.currency, store.isArabic ? 'ar' : 'en')
}

function percent(value: number, isArabic = false): string {
  return formatAmortizationPercent(value, isArabic ? 'ar' : 'en')
}

function date(value: string): string {
  return formatAmortizationDate(value, store.isArabic ? 'ar' : 'en')
}

function frequencyLabel(value: InstallmentFrequency): string {
  const labels: Record<InstallmentFrequency, [string, string]> = {
    MONTHLY: ['Monthly', 'شهري'],
    QUARTERLY: ['Quarterly', 'ربع سنوي'],
    SEMI_ANNUAL: ['Semi-annual', 'نصف سنوي'],
    ANNUAL: ['Annual', 'سنوي']
  }
  return store.isArabic ? labels[value][1] : labels[value][0]
}

function rateModeLabel(value: RateMode): string {
  return value === 'FLAT'
    ? t('Flat markup', 'هامش ثابت')
    : t('Amortized', 'متناقص')
}

function addBalloon(): void {
  form.balloons.push({ month: String(Math.min(plan.value?.termMonths || 12, form.balloons.length + 1)), amount: '' })
}

function removeBalloon(index: number): void {
  form.balloons.splice(index, 1)
}

function onPrint(): void {
  window.print()
}

function onWhatsApp(): void {
  if (!plan.value) return
  const opened = openAmortizationWhatsApp({
    phone: form.phone,
    input: planInput.value,
    language: store.isArabic ? 'ar' : 'en'
  })
  actionMessage.value = opened
    ? t('WhatsApp message opened in a new tab.', 'تم فتح رسالة واتساب في تبويب جديد.')
    : t('Enter a valid WhatsApp number first.', 'أدخل رقم واتساب صالحاً أولاً.')
}

async function copySummary(): Promise<void> {
  if (!plan.value) return
  const text = buildAmortizationSummaryText(plan.value, store.isArabic ? 'ar' : 'en', plan.value.currency)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const field = document.createElement('textarea')
      field.value = text
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    actionMessage.value = t('Amortization summary copied.', 'تم نسخ ملخص جدول السداد.')
  } catch {
    actionMessage.value = t('Could not copy the summary automatically.', 'تعذر نسخ الملخص تلقائياً.')
  }
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.hero, .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 1.2rem; }
.hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.hero h1 { margin: 0.35rem 0; font-size: 1.6rem; }
.badge { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.72rem; font-weight: 700; }
.muted { color: #6b7280; font-size: 0.82rem; margin: 0; }
.error { color: #991b1b; font-size: 0.84rem; }
h2 { margin: 0 0 0.9rem; font-size: 1.05rem; }
h3 { margin: 1rem 0 0.5rem; font-size: 0.95rem; }
.calculator-grid { display: grid; grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.1fr); gap: 1rem; align-items: start; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.7rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
input, select { min-height: 40px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0.45rem 0.6rem; background: #fff; color: #111827; }
.balloon-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
.balloon-list { display: flex; flex-direction: column; gap: 0.5rem; }
.balloon-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.6rem; align-items: end; }
button { min-height: 40px; }
button.danger { color: #b91c1c; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; }
.tag { background: #ecfdf5; color: #047857; border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.7rem; font-weight: 700; }
.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.6rem; }
.summary-card { background: #f9fafb; border-radius: 10px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.25rem; }
.summary-card span { color: #6b7280; font-size: 0.7rem; }
.summary-card strong { color: #4338ca; font-size: 1.02rem; }
.result-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.8rem; }
.btn-whatsapp { background: #128c7e; color: #fff; border-color: #128c7e; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th, td { text-align: start; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.footnote { color: #6b7280; font-size: 0.75rem; margin-top: 0.6rem; }
.print-only { display: none; }
@media print {
  .no-print, .result-actions, .error { display: none !important; }
  .print-only { display: block !important; }
  .page { gap: 0.5rem; }
  .hero, .panel { border: 0; padding: 0; box-shadow: none; }
  .calculator-grid { display: block; }
  .table-wrap { overflow: visible; }
  table { font-size: 0.72rem; }
  th, td { padding: 0.35rem; }
}
@media (max-width: 768px) {
  .calculator-grid { grid-template-columns: 1fr; }
  .balloon-row { grid-template-columns: 1fr; }
  input, select, button { min-height: 44px; }
  .result-actions { flex-direction: column; }
}
</style>
