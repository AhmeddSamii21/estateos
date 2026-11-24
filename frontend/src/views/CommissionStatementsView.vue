<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'كشوف العمولات' : 'Commission statements' }}</h1>
        <p class="muted">{{ pageSubtitle }}</p>
      </div>
      <div class="head-actions">
        <form class="date-form" @submit.prevent="load">
          <input v-model="filters.from" type="date" :aria-label="store.isArabic ? 'من' : 'From'" />
          <input v-model="filters.to" type="date" :aria-label="store.isArabic ? 'إلى' : 'To'" />
          <select v-if="!isAgent" v-model="filters.agentId" :aria-label="store.isArabic ? 'الوكيل' : 'Agent'">
            <option value="">{{ store.isArabic ? 'كل الوكلاء' : 'All agents' }}</option>
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.label }}</option>
          </select>
          <button class="btn btn-primary" type="submit">{{ store.isArabic ? 'تطبيق' : 'Apply' }}</button>
        </form>
        <label class="consolidated">
          <input v-model="filters.consolidated" type="checkbox" />
          <span>{{ store.isArabic ? 'إجمالي عملة الأساس' : 'Base-currency total' }}</span>
        </label>
        <button class="btn btn-quiet" type="button" :disabled="exporting" @click="onExport">
          <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
        </button>
        <button class="btn btn-quiet no-print" type="button" @click="onPrint">
          <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة / حفظ PDF' : 'Print / PDF' }}
        </button>
      </div>
    </div>

    <div class="print-only print-brand">
      <div class="print-brand-top">
        <strong>EstateOS</strong>
        <span>{{ printGeneratedAt }}</span>
      </div>
      <h1>{{ store.isArabic ? 'كشوف العمولات' : 'Commission statements' }}</h1>
      <p>{{ pageSubtitle }} · {{ printRange }}</p>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="error" class="error" role="alert">{{ error }}</div>
    <template v-else-if="statement">
      <section class="stats">
        <article v-for="card in statusCards" :key="card.status" class="stat" :class="`stat-${card.status.toLowerCase()}`">
          <span>{{ statusLabel(card.status) }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.count }} {{ store.isArabic ? 'عمولة' : 'commission(s)' }}</small>
        </article>
      </section>

      <p v-if="consolidatedNote" class="fx-note">{{ consolidatedNote }}</p>

      <section class="panel">
        <h2>{{ store.isArabic ? 'التفاصيل حسب الوكيل والحالة والعملة' : 'Breakdown by agent, status and currency' }}</h2>
        <div v-if="!statement.lines.length" class="empty">
          {{ store.isArabic ? 'لا توجد عمولات للفترة المحددة.' : 'No commissions for the selected period.' }}
        </div>
        <table v-else>
          <thead>
            <tr>
              <th>{{ store.isArabic ? 'الوكيل' : 'Agent' }}</th>
              <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
              <th>{{ store.isArabic ? 'العملة' : 'Currency' }}</th>
              <th>{{ store.isArabic ? 'العدد' : 'Count' }}</th>
              <th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th>
              <th v-if="filters.consolidated">{{ store.isArabic ? 'بعملة الأساس' : 'In base currency' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in statement.lines" :key="`${line.agentId}-${line.status}-${line.currency}-${index}`">
              <td>{{ line.agentName }}</td>
              <td><span class="status-pill" :class="`status-${line.status.toLowerCase()}`">{{ statusLabel(line.status) }}</span></td>
              <td>{{ line.currency }}</td>
              <td>{{ line.count }}</td>
              <td><strong>{{ money(line.amount, line.currency) }}</strong></td>
              <td v-if="filters.consolidated">{{ line.baseAmount == null ? '—' : money(line.baseAmount, statement.fx?.baseCurrency) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, errorMessage } from '@/api/client'
import { downloadCsv, type CsvColumn, type CsvRow } from '@/utils/csv'
import { useStore } from '@/stores'

type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID'

interface StatementLine {
  agentId: string
  agentName: string
  status: CommissionStatus
  currency: string
  count: number
  amount: string
  baseAmount: string | null
}

interface StatementTotal {
  status: CommissionStatus
  currency: string
  count: number
  amount: string
}

interface FxSummary {
  baseCurrency: string
  missingCurrencies: string[]
  [key: string]: unknown
}

interface Statement {
  lines: StatementLine[]
  totals: StatementTotal[]
  fxRows: Array<{ currency: string; amount: string }>
  fx: FxSummary | null
  scope: 'AGENT' | 'ALL'
  agentId: string | null
  commissionCount: number
}

const store = useStore()
const isAgent = computed(() => store.user?.role === 'AGENT')
const printGeneratedAt = computed(() => new Date().toLocaleString(store.isArabic ? 'ar' : 'en'))
const pageSubtitle = computed(() => isAgent.value
  ? (store.isArabic ? 'عمولاتك حسب الحالة والعملة' : 'Your commissions by status and currency')
  : (store.isArabic ? 'عمولات جميع الوكلاء حسب الحالة والعملة' : 'All agents’ commissions by status and currency'))
const statement = ref<Statement | null>(null)
const agents = ref<Array<{ id: string; label: string }>>([])
const loading = ref(true)
const exporting = ref(false)
const error = ref('')
const filters = reactive({ from: '', to: '', agentId: '', consolidated: false })

const printRange = computed(() => {
  const from = store.isArabic ? 'من' : 'From'
  const to = store.isArabic ? 'إلى' : 'To'
  if (filters.from && filters.to) return `${from}: ${filters.from} · ${to}: ${filters.to}`
  if (filters.from) return `${from}: ${filters.from}`
  if (filters.to) return `${to}: ${filters.to}`
  return store.isArabic ? 'كل الفترات' : 'All dates'
})

const statuses: CommissionStatus[] = ['PENDING', 'APPROVED', 'PAID']

onMounted(async () => {
  if (!isAgent.value) await loadAgents()
  await load()
})

async function loadAgents(): Promise<void> {
  try {
    const response = await apiGet<Array<{ id: string; firstName?: string | null; email?: string }> | { data: Array<{ id: string; firstName?: string | null; email?: string }> }>(
      '/users',
      { params: { limit: 100 } }
    )
    const payload = response.data
    const users = Array.isArray(payload) ? payload : (payload?.data || [])
    agents.value = users.map((user) => ({
      id: user.id,
      label: (user.firstName && String(user.firstName).trim()) || String(user.email || user.id)
    }))
  } catch {
    // Agent filter is optional; statement still loads without the user list.
    agents.value = []
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const params: Record<string, string | boolean> = { consolidated: filters.consolidated }
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  if (!isAgent.value && filters.agentId) params.agentId = filters.agentId
  try {
    const response = await apiGet<Statement>('/finance/commission-statements', { params })
    statement.value = response.data
  } catch (caught) {
    error.value = errorMessage(caught)
    statement.value = null
  } finally {
    loading.value = false
  }
}

function statusLabel(status: CommissionStatus): string {
  const labels: Record<CommissionStatus, [string, string]> = {
    PENDING: ['Pending', 'قيد الانتظار'],
    APPROVED: ['Approved', 'معتمدة'],
    PAID: ['Paid', 'مدفوعة']
  }
  return store.isArabic ? labels[status][1] : labels[status][0]
}

const statusCards = computed(() => statuses.map((status) => {
  const relevant = (statement.value?.totals || []).filter((row) => row.status === status)
  const byCurrency = relevant.map((row) => money(row.amount, row.currency)).join(' · ')
  return {
    status,
    value: relevant.length ? byCurrency : '—',
    count: relevant.reduce((sum, row) => sum + row.count, 0)
  }
}))

const consolidatedNote = computed(() => {
  const fx = statement.value?.fx
  if (!filters.consolidated || !fx) return ''
  const convertedKey = Object.keys(fx).find((key) => key.toLowerCase().includes('converted'))
  const converted = convertedKey ? Number(fx[convertedKey] ?? 0) : null
  const total = converted != null && Number.isFinite(converted)
    ? money(converted, fx.baseCurrency)
    : '—'
  const missing = fx.missingCurrencies?.length
    ? `${store.isArabic ? 'بدون سعر' : 'no rate'}: ${fx.missingCurrencies.join(', ')}`
    : ''
  return `${store.isArabic ? 'الإجمالي بعملة الأساس' : 'Total in base currency'}: ${total}${missing ? ` (${missing})` : ''}`
})

function money(amount: string | number, currency: string | null | undefined): string {
  const code = String(currency || 'UNSPECIFIED').trim().toUpperCase()
  const value = Number(amount || 0)
  if (code === 'UNSPECIFIED') return `${value.toFixed(2)} UNSPECIFIED`
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: code, maximumFractionDigits: 2
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${code}`
  }
}

function onPrint(): void {
  window.print()
}

function onExport(): void {
  if (exporting.value || !statement.value) return
  exporting.value = true
  try {
    const t = (english: string, arabic: string) => store.isArabic ? arabic : english
    const columns: CsvColumn[] = [
      { key: 'agent', label: t('Agent', 'الوكيل') },
      { key: 'status', label: t('Status', 'الحالة') },
      { key: 'currency', label: t('Currency', 'العملة') },
      { key: 'count', label: t('Count', 'العدد') },
      { key: 'amount', label: t('Amount', 'المبلغ') },
      { key: 'baseAmount', label: t('Base amount', 'بعملة الأساس') }
    ]
    const rows: CsvRow[] = statement.value.lines.map((line) => ({
      agent: line.agentName,
      status: statusLabel(line.status),
      currency: line.currency,
      count: line.count,
      amount: line.amount,
      baseAmount: line.baseAmount ?? ''
    }))
    downloadCsv(`commission-statement-${filters.from || 'all'}-${filters.to || 'all'}`, columns, rows)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 1rem; font-size: 1.05rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.date-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.head-actions { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; }
.consolidated { display: flex; flex-direction: row; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: #374151; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; }
.stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.stat span { font-size: 0.75rem; color: #6b7280; }
.stat strong { font-size: 1.15rem; color: #312e81; }
.stat small { font-size: 0.72rem; color: #6b7280; }
.stat-paid strong { color: #166534; }
.stat-pending strong { color: #92400e; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; }
.status-pill { display: inline-block; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.72rem; background: #e0e7ff; color: #3730a3; }
.status-paid { background: #dcfce7; color: #166534; }
.status-pending { background: #fef3c7; color: #92400e; }
table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
th, td { text-align: start; padding: 0.6rem; border-bottom: 1px solid #f3f4f6; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.state, .empty { padding: 3rem; text-align: center; background: #fff; border-radius: 12px; color: #6b7280; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.8rem; }
.fx-note { margin: 0; font-size: 0.78rem; color: #6b7280; }
.panel { overflow-x: auto; }
@media (max-width: 768px) {
  .panel { overflow-x: auto; }
  table { min-width: 520px; }
  .btn, input, select { min-height: 44px; }
  th, td { white-space: nowrap; }
}
@media (max-width: 768px) {
  .panel { overflow-x: auto; padding-inline: 0.75rem; }
  .panel table { min-width: 640px; }
  .btn, .date-form input, .date-form select { min-height: 44px; }
}
</style>
