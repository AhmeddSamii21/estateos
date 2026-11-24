<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'التقارير والتحليلات' : 'Reports & analytics' }}</h1>
        <p class="muted">{{ store.isArabic ? 'مؤشرات الأداء والمالية والعمليات' : 'Performance, finance, and operations indicators' }}</p>
      </div>
      <div class="head-actions no-print">
        <form class="date-form" @submit.prevent="load">
          <input v-model="filters.from" type="date" />
          <input v-model="filters.to" type="date" />
          <button class="btn btn-primary" type="submit">{{ store.isArabic ? 'تطبيق' : 'Apply' }}</button>
        </form>
        <button class="btn btn-quiet" type="button" :disabled="exporting" @click="onExport">
          <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
        </button>
        <button class="btn btn-quiet" type="button" @click="onPrint">
          <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة' : 'Print' }}
        </button>
      </div>
    </div>

    <div class="print-only">
      <h1>{{ store.isArabic ? 'التقارير والتحليلات' : 'Reports & analytics' }}</h1>
      <p>{{ printRange }}</p>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="error" class="error" role="alert">{{ error }}</div>
    <div v-else-if="exportError" class="error" role="alert">{{ exportError }}</div>

    <template v-else-if="summary">
      <section class="stats">
        <article v-for="card in cards" :key="card.label" class="stat">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </section>

      <section class="panel funnel-sla">
        <h2>{{ store.isArabic ? 'القمع ومستوى الخدمة' : 'Funnel & SLA' }}</h2>
        <div v-if="!funnel && !sla" class="empty">{{ store.isArabic ? 'لا توجد بيانات كافية.' : 'No funnel or SLA data available.' }}</div>
        <template v-else>
          <div v-if="funnel" class="funnel">
            <div class="funnel-summary">
              <span>{{ store.isArabic ? 'إجمالي العملاء المحتملين' : 'Total leads' }}: <strong>{{ funnel.leads?.total ?? 0 }}</strong></span>
              <span>{{ store.isArabic ? 'إجمالي الصفقات' : 'Total deals' }}: <strong>{{ funnel.deals?.total ?? 0 }}</strong></span>
              <span>{{ store.isArabic ? 'الصفقات المغلقة' : 'Closed deals' }}: <strong>{{ funnel.deals?.closed ?? 0 }}</strong></span>
            </div>
            <div class="funnel-stages">
              <article v-for="stage in funnelStages" :key="stage.stage" class="funnel-stage">
                <span class="funnel-stage-label">{{ stage.label }}</span>
                <strong class="funnel-stage-count">{{ stage.count }}</strong>
                <small class="funnel-stage-rate">{{ formatRate(stage.conversionRate) }}</small>
              </article>
            </div>
            <p class="funnel-note">
              {{ store.isArabic
                ? 'نسب التحويل من المرحلة السابقة، باستثناء إجمالي العملاء المحتملين إلى الصفقات المغلقة.'
                : 'Conversion is relative to the previous stage, except lead-to-closed-deal.' }}
              <template v-if="funnel.conversionRates">
                · {{ store.isArabic ? 'من العميل إلى الصفقة' : 'Lead to deal' }}: {{ formatRate(funnel.conversionRates?.leadToClosedDeal) }}
              </template>
            </p>
          </div>
          <div v-if="sla" class="sla">
            <h3>{{ store.isArabic ? 'عملاء محتملون لم يتم التواصل معهم' : 'Uncontacted leads' }}</h3>
            <p class="sla-count">{{ sla.uncontactedCount ?? 0 }}</p>
            <div v-if="!slaLeads.length" class="empty">{{ store.isArabic ? 'لا توجد سجلات متأخرة.' : 'No breached leads.' }}</div>
            <table v-else class="sla-table">
              <thead>
                <tr>
                  <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
                  <th>{{ store.isArabic ? 'البريد الإلكتروني' : 'Email' }}</th>
                  <th>{{ store.isArabic ? 'العمر (ساعات)' : 'Age (hours)' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="lead in slaLeads" :key="lead.id">
                  <td>{{ leadName(lead) }}</td>
                  <td>{{ lead.email || '—' }}</td>
                  <td>{{ lead.ageHours ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
            <button class="btn btn-quiet no-print" type="button" :disabled="csvBusy" @click="onDownloadUncontactedCsv">
              <i class="fas fa-download"></i> {{ csvBusy ? '…' : (store.isArabic ? 'تنزيل CSV للعملاء غير المتواصل معهم' : 'Download uncontacted CSV') }}
            </button>
            <div v-if="csvError" class="error" role="alert">{{ csvError }}</div>
          </div>
        </template>
      </section>

      <div class="columns">
        <section class="panel">
          <h2>{{ store.isArabic ? 'العقارات حسب الحالة' : 'Properties by status' }}</h2>
          <BarList :items="statusBars" />
        </section>
        <section class="panel">
          <h2>{{ store.isArabic ? 'العقارات حسب النوع' : 'Properties by type' }}</h2>
          <BarList :items="typeBars" />
        </section>
        <section class="panel">
          <h2>{{ store.isArabic ? 'العقارات حسب المدينة' : 'Properties by city' }}</h2>
          <BarList :items="cityBars" />
        </section>
        <section class="panel">
          <h2>{{ store.isArabic ? 'الصيانة حسب الحالة' : 'Maintenance by status' }}</h2>
          <BarList :items="maintenanceBars" />
        </section>
      </div>

      <section class="panel">
        <h2>{{ store.isArabic ? 'ملخص مالي' : 'Financial summary' }}</h2>
        <div class="finance">
          <div><span>{{ store.isArabic ? 'الدفعات' : 'Payments' }}</span><strong>{{ breakdown(paymentTotals) }}</strong></div>
          <div><span>{{ store.isArabic ? 'المصروفات' : 'Expenses' }}</span><strong>{{ breakdown(expenseTotals) }}</strong></div>
          <div><span>{{ store.isArabic ? 'العمولات' : 'Commissions' }}</span><strong>{{ breakdown(commissionTotals) }}</strong></div>
          <div><span>{{ store.isArabic ? 'الصافي حسب العملة' : 'Net by currency' }}</span><strong>{{ breakdown(netTotals) }}</strong></div>
          <div><span>{{ store.isArabic ? 'تكلفة الصيانة' : 'Maintenance cost' }}</span><strong>{{ maintenanceCostLabel }}</strong></div>
          <div v-if="summary.finance.fx">
            <span>{{ store.isArabic ? 'الدفعات بعملة الأساس' : 'Payments in base currency' }}</span>
            <strong>{{ baseCurrencyTotalLabel }}</strong>
          </div>
        </div>
        <p class="finance-note">
          {{ store.isArabic
            ? 'تُعرض المجاميع حسب العملة المصدر، مع إجمالي الدفعات المُحوّل إلى العملة الأساسية عند توفر الأسعار. عملة تكلفة الصيانة غير متوفرة في استجابة API.'
            : 'Amounts are grouped by source currency, with payments also converted to the base currency when rates are available. Maintenance-cost currency is not supplied by the API.' }}
        </p>
      </section>

      <section class="panel">
        <h2>{{ store.isArabic ? 'أداء الفريق' : 'Team performance' }}</h2>
        <div v-if="!teamRows.length" class="empty">{{ store.isArabic ? 'لا توجد بيانات كافية.' : 'No team data available.' }}</div>
        <table v-else>
          <thead>
            <tr>
              <th>{{ store.isArabic ? 'المستخدم' : 'User' }}</th>
              <th>{{ store.isArabic ? 'الصفقات' : 'Deals' }}</th>
              <th>{{ store.isArabic ? 'قيمة الصفقات حسب العملة' : 'Deal value by currency' }}</th>
              <th>{{ store.isArabic ? 'عملاء محتملون' : 'Leads' }}</th>
              <th>{{ store.isArabic ? 'مواعيد' : 'Appointments' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in teamRows" :key="row.userId">
              <td>{{ row.label }}</td>
              <td>{{ row.deals }}</td>
              <td>{{ breakdown(row.dealValues) }}</td>
              <td>{{ row.leads }}</td>
              <td>{{ row.appointments }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, errorMessage, tokenStore, type ApiEnvelope } from '@/api/client'
import BarList from '@/components/BarList.vue'
import { downloadCsv, type CsvColumn, type CsvRow } from '@/utils/csv'
import { useStore } from '@/stores'
import type { GroupCount, MoneyValue, ReportSummary } from '@/types'

interface CurrencyAmountRow {
  currency: string
  amount: MoneyValue
}

interface CurrencyTotal {
  currency: string
  amount: number
}

interface TeamDealRow {
  userId: string
  currency: string
  count: number
  value: MoneyValue
}

interface TeamRow {
  userId: string
  label: string
  deals: number
  dealValues: CurrencyTotal[]
  leads: number
  appointments: number
}

interface FunnelStageRow {
  stage: string
  label: string
  count: number
  conversionRate: number
}

interface FunnelMetrics {
  leads: { total: number; new: number; engaged: number; viewing: number; won: number }
  deals: { total: number; closed: number }
  stages: FunnelStageRow[]
  conversionRates?: Record<string, number>
}

interface UncontactedLeadRow {
  id: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  createdAt?: string
  ageHours?: number
}

interface SlaMetrics {
  uncontactedCount: number
  uncontactedLeads?: UncontactedLeadRow[]
}

interface ReportSummaryWithExtras extends ReportSummary {
  funnel?: FunnelMetrics
  sla?: SlaMetrics
}

interface TeamReportResponse {
  deals: TeamDealRow[]
  leads: Array<{ userId: string | null; count: number }>
  appointments: Array<{ userId: string; count: number }>
  funnel?: FunnelMetrics
  sla?: SlaMetrics
}

type UserRow = { id: string; firstName?: string | null; email?: string }
type UsersResponse = UserRow[] | { data: UserRow[] }

const store = useStore()
const summary = ref<ReportSummaryWithExtras | null>(null)
const team = ref<Partial<TeamReportResponse>>({})
const loading = ref(true)
const error = ref('')
const exportError = ref('')
const exporting = ref(false)
const csvBusy = ref(false)
const csvError = ref('')
const userLabels = ref<Record<string,string>>({})
const filters = reactive({ from: '', to: '' })

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const params: Record<string, string> = {}
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  try {
    const canLoadUsers = store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER'
    const [summaryResponse, teamResponse, usersResponse] = await Promise.all<
      [ApiEnvelope<ReportSummaryWithExtras>, ApiEnvelope<TeamReportResponse>, ApiEnvelope<UsersResponse> | undefined]
    >([
      apiGet<ReportSummaryWithExtras>('/reports/summary', { params }),
      apiGet<TeamReportResponse>('/reports/team', { params }),
      canLoadUsers ? apiGet<UsersResponse>('/users', { params: { limit: 100 } }) : Promise.resolve(undefined)
    ])
    summary.value = summaryResponse.data
    team.value = teamResponse.data
    if (usersResponse) {
      const payload = usersResponse.data
      const users = Array.isArray(payload) ? payload : (payload?.data || [])
      const map: Record<string, string> = {}
      for (const u of users) {
        const label = (u.firstName && String(u.firstName).trim()) || (u.email && String(u.email).trim()) || String(u.id)
        map[String(u.id)] = label
      }
      userLabels.value = map
    } else {
      userLabels.value = {}
    }
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

const funnel = computed<FunnelMetrics | null>(() => summary.value?.funnel ?? team.value?.funnel ?? null)
const sla = computed<SlaMetrics | null>(() => summary.value?.sla ?? team.value?.sla ?? null)
const funnelStages = computed<FunnelStageRow[]>(() => funnel.value?.stages ?? [])
const slaLeads = computed<UncontactedLeadRow[]>(() => sla.value?.uncontactedLeads ?? [])

function formatRate(rate: number | null | undefined): string {
  const value = Number(rate ?? 0)
  if (!Number.isFinite(value)) return '0%'
  const percent = Math.abs(value) <= 1 ? value * 100 : value
  return `${new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', { maximumFractionDigits: 1 }).format(percent)}%`
}

function leadName(lead: UncontactedLeadRow): string {
  return `${lead.firstName ?? ''}${lead.lastName ? ` ${lead.lastName}` : ''}`.trim() || lead.email || lead.id
}

async function onDownloadUncontactedCsv(): Promise<void> {
  const token = tokenStore.get()
  if (!token) {
    csvError.value = store.isArabic ? 'انتهت الجلسة. سجّل الدخول مرة أخرى.' : 'Session expired. Please sign in again.'
    return
  }
  csvBusy.value = true
  csvError.value = ''
  try {
    const response = await fetch('/api/reports/uncontacted-leads?format=csv', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error(store.isArabic ? 'تعذّر تنزيل التقرير.' : 'Unable to download the report.')
    const text = await response.text()
    const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `uncontacted-leads-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (caught) {
    csvError.value = errorMessage(caught)
  } finally {
    csvBusy.value = false
  }
}

const printRange = computed(() => {
  const from = store.isArabic ? 'من' : 'From'
  const to = store.isArabic ? 'إلى' : 'To'
  if (filters.from && filters.to) return `${from}: ${filters.from} · ${to}: ${filters.to}`
  if (filters.from) return `${from}: ${filters.from}`
  if (filters.to) return `${to}: ${filters.to}`
  return store.isArabic ? 'كل الفترات' : 'All dates'
})

function onPrint(): void {
  window.print()
}

function onExport(): void {
  if (exporting.value) return
  if (!summary.value) {
    exportError.value = store.isArabic ? 'لا توجد بيانات للتصدير.' : 'No report data to export.'
    return
  }
  exporting.value = true
  exportError.value = ''
  try {
    const t = (english: string, arabic: string) => store.isArabic ? arabic : english
    const columns: CsvColumn[] = [
      { key: 'section', label: t('Section', 'القسم') },
      { key: 'label', label: t('Label', 'البيان') },
      { key: 'count', label: t('Count', 'العدد') },
      { key: 'amount', label: t('Amount', 'المبلغ') },
      { key: 'currency', label: t('Currency', 'العملة') },
      { key: 'from', label: t('From', 'من') },
      { key: 'to', label: t('To', 'إلى') },
      { key: 'note', label: t('Note', 'ملاحظة') }
    ]
    const rows: CsvRow[] = []
    const add = (section: string, label: string, values: Record<string, unknown> = {}) => {
      rows.push({
        section,
        label,
        count: '',
        amount: '',
        currency: '',
        from: filters.from,
        to: filters.to,
        note: '',
        ...values
      })
    }
    const report = summary.value
    const overview = t('Overview', 'نظرة عامة')
    add(overview, t('Total properties', 'إجمالي العقارات'), { count: report.properties.total })
    add(overview, t('Available', 'متاحة'), { count: report.properties.available })
    add(overview, t('Unavailable', 'غير متاحة'), { count: report.properties.unavailable })
    add(overview, t('Active deals', 'الصفقات النشطة'), { count: report.deals.active })
    add(overview, t('Completed deals', 'الصفقات المكتملة'), { count: report.deals.completed })

    const propertySection = t('Properties', 'العقارات')
    for (const row of report.properties.byStatus) add(`${propertySection} / ${t('Status', 'الحالة')}`, String(row.status ?? '—'), { count: row._count?._all ?? 0 })
    for (const row of report.properties.byType) add(`${propertySection} / ${t('Type', 'النوع')}`, String(row.type ?? '—'), { count: row._count?._all ?? 0 })
    for (const row of report.properties.byCity) add(`${propertySection} / ${t('City', 'المدينة')}`, String(row.city ?? '—'), { count: row._count?._all ?? 0 })
    for (const row of report.maintenance.byStatus) add(t('Maintenance', 'الصيانة'), String(row.status ?? '—'), { count: row._count?._all ?? 0 })

    const financeGroups: Array<[string, CurrencyTotal[]]> = [
      [t('Payments', 'الدفعات'), paymentTotals.value],
      [t('Expenses', 'المصروفات'), expenseTotals.value],
      [t('Commissions', 'العمولات'), commissionTotals.value],
      [t('Net by currency', 'الصافي حسب العملة'), netTotals.value]
    ]
    for (const [section, totals] of financeGroups) {
      if (!totals.length) add(section, t('No data', 'لا توجد بيانات'))
      for (const total of totals) add(section, total.currency, { amount: total.amount.toFixed(2), currency: total.currency })
    }
    const fx = report.finance.fx
    if (fx) {
      add(t('Finance', 'المالية'), t('Payments in base currency', 'الدفعات بعملة الأساس'), {
        amount: fx.convertedPaymentTotal ?? '',
        currency: fx.baseCurrency,
        note: fx.missingCurrencies.length ? `${t('No rate for', 'بدون سعر')}: ${fx.missingCurrencies.join(', ')}` : ''
      })
    }
    add(t('Maintenance', 'الصيانة'), t('Cost', 'التكلفة'), {
      amount: Number(report.maintenance.totalCost || 0).toFixed(2),
      currency: 'UNSPECIFIED',
      note: t('Currency not supplied by API', 'العملة غير متوفرة في API')
    })

    const teamSection = t('Team', 'الفريق')
    for (const row of teamRows.value) {
      add(teamSection, row.userId, { count: row.deals, note: t('Deals', 'صفقات') })
      for (const value of row.dealValues) add(`${teamSection} / ${t('Deal value', 'قيمة الصفقات')}`, row.userId, {
        amount: value.amount.toFixed(2), currency: value.currency
      })
      add(teamSection, row.userId, { count: row.leads, note: t('Leads', 'عملاء محتملون') })
      add(teamSection, row.userId, { count: row.appointments, note: t('Appointments', 'مواعيد') })
    }

    downloadCsv(`estateos-report-${filters.from || 'all'}-${filters.to || 'all'}`, columns, rows)
  } catch (caught) {
    exportError.value = errorMessage(caught)
  } finally {
    exporting.value = false
  }
}

function bars(rows: GroupCount[], key: 'status' | 'type' | 'city'): Array<{ label: string; value: number }> {
  return rows.map((row) => ({
    label: String(row[key] ?? '—'),
    value: Number(row._count?._all || 0)
  }))
}

function normalizeCurrency(currency: string | null | undefined): string {
  return currency?.trim().toUpperCase() || 'UNSPECIFIED'
}

function sumByCurrency(rows: CurrencyAmountRow[]): CurrencyTotal[] {
  const grouped = new Map<string, number>()
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency)
    grouped.set(currency, (grouped.get(currency) || 0) + Number(row.amount || 0))
  }
  return Array.from(grouped, ([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

function compact(amount: number): string {
  return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number.isFinite(amount) ? amount : 0)
}

function money(amount: number, currency: string | null | undefined): string {
  const code = normalizeCurrency(currency)
  if (code === 'UNSPECIFIED') return `${compact(amount)} UNSPECIFIED`
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1
    }).format(amount)
  } catch {
    return `${compact(amount)} ${code}`
  }
}

function breakdown(rows: CurrencyTotal[]): string {
  if (!rows.length) return '—'
  return rows.map((row) => money(row.amount, row.currency)).join(' · ')
}

const statusBars = computed(() => bars(summary.value?.properties?.byStatus || [], 'status'))
const typeBars = computed(() => bars(summary.value?.properties?.byType || [], 'type'))
const cityBars = computed(() => bars(summary.value?.properties?.byCity || [], 'city'))
const maintenanceBars = computed(() => bars(summary.value?.maintenance?.byStatus || [], 'status'))

const paymentTotals = computed(() => sumByCurrency(summary.value?.finance.payments || []))
const expenseTotals = computed(() => sumByCurrency(summary.value?.finance.expenses || []))
const commissionTotals = computed(() => sumByCurrency(summary.value?.finance.commissions || []))
const netTotals = computed<CurrencyTotal[]>(() => {
  const grouped = new Map<string, number>()
  for (const row of paymentTotals.value) grouped.set(row.currency, row.amount)
  for (const row of expenseTotals.value) grouped.set(row.currency, (grouped.get(row.currency) || 0) - row.amount)
  return Array.from(grouped, ([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
})

const maintenanceCostLabel = computed(() => {
  const total = Number(summary.value?.maintenance.totalCost || 0)
  return `${compact(total)} · ${store.isArabic ? 'العملة غير متوفرة' : 'currency not supplied'}`
})

const baseCurrencyTotalLabel = computed(() => {
  const fx = summary.value?.finance.fx
  if (!fx) return '—'
  if (fx.convertedPaymentTotal === null) {
    return store.isArabic ? 'أسعار مفقودة' : 'rates unavailable'
  }
  const label = money(Number(fx.convertedPaymentTotal), fx.baseCurrency)
  return fx.missingCurrencies.length
    ? `${label} (${store.isArabic ? 'بدون سعر' : 'no rate'}: ${fx.missingCurrencies.join(', ')})`
    : label
})

const cards = computed(() => [
  { label: store.isArabic ? 'إجمالي العقارات' : 'Total properties', value: summary.value?.properties?.total ?? 0 },
  { label: store.isArabic ? 'متاحة' : 'Available', value: summary.value?.properties?.available ?? 0 },
  { label: store.isArabic ? 'غير متاحة' : 'Unavailable', value: summary.value?.properties?.unavailable ?? 0 },
  { label: store.isArabic ? 'الصفقات النشطة' : 'Active deals', value: summary.value?.deals?.active ?? 0 },
  { label: store.isArabic ? 'الصفقات المكتملة' : 'Completed deals', value: summary.value?.deals?.completed ?? 0 },
  { label: store.isArabic ? 'الدفعات المستلمة' : 'Payments received', value: breakdown(paymentTotals.value) }
])

const teamRows = computed<TeamRow[]>(() => {
  const deals = (team.value?.deals || []) as TeamDealRow[]
  const leads = (team.value?.leads || []) as Array<{ userId: string | null; count: number }>
  const appointments = (team.value?.appointments || []) as Array<{ userId: string; count: number }>
  const map = new Map<string, TeamRow>()

  for (const row of deals) {
    const current = map.get(row.userId) || {
      userId: row.userId,
      deals: 0,
      dealValues: [],
      leads: 0,
      appointments: 0
    }
    current.deals += row.count
    current.dealValues = sumByCurrency([
      ...current.dealValues,
      { currency: row.currency, amount: row.value }
    ])
    map.set(row.userId, current)
  }

  for (const row of leads) {
    if (!row.userId) continue
    const current = map.get(row.userId) || {
      userId: row.userId,
      deals: 0,
      dealValues: [],
      leads: 0,
      appointments: 0
    }
    current.leads += row.count
    map.set(row.userId, current)
  }

  for (const row of appointments) {
    const current = map.get(row.userId) || {
      userId: row.userId,
      deals: 0,
      dealValues: [],
      leads: 0,
      appointments: 0
    }
    current.appointments += row.count
    map.set(row.userId, current)
  }

  return Array.from(map.values())
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 1rem; font-size: 1.05rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.date-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.head-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.print-only { display: none; }
input { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; }
.btn { border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.funnel-sla { display: flex; flex-direction: column; gap: 0.9rem; }
.funnel-sla h3 { margin: 0; font-size: 0.92rem; color: #374151; }
.funnel-summary { display: flex; gap: 1.1rem; flex-wrap: wrap; font-size: 0.8rem; color: #4b5563; }
.funnel-stages { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.6rem; }
.funnel-stage { background: #f8fafc; border-radius: 8px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.2rem; }
.funnel-stage-label { font-size: 0.74rem; color: #6b7280; }
.funnel-stage-count { font-size: 1.1rem; color: #312e81; }
.funnel-stage-rate { font-size: 0.72rem; color: #4f46e5; }
.funnel-note { margin: 0; font-size: 0.74rem; color: #6b7280; }
.sla { display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
.sla-count { margin: 0; font-size: 1.5rem; font-weight: 700; color: #b91c1c; }
.sla-table { font-size: 0.8rem; }
.sla .btn { align-self: flex-start; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
.stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.stat span { font-size: 0.75rem; color: #6b7280; }
.stat strong { font-size: 1.35rem; color: #312e81; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; }
.finance { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
.finance div { background: #f8fafc; border-radius: 8px; padding: 0.8rem; display: flex; flex-direction: column; }
.finance span { font-size: 0.74rem; color: #6b7280; }
.finance strong { color: #312e81; font-size: 0.95rem; }
.finance-note { margin: 0.8rem 0 0; font-size: 0.75rem; color: #6b7280; }
table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
th, td { text-align: start; padding: 0.55rem 0.6rem; border-bottom: 1px solid #f3f4f6; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.state, .empty { padding: 3rem; text-align: center; background: #fff; border-radius: 12px; color: #6b7280; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.8rem; }
</style>

<style>
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #fff !important; color: #111827 !important; }
  .sidebar, .topbar, .no-print, .overlay { display: none !important; }
  .workspace { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  .print-only { display: block !important; margin-bottom: 0.8rem; }
  .print-only h1 { font-size: 1.25rem; margin: 0 0 0.2rem; }
  .print-only p { margin: 0; font-size: 0.85rem; color: #374151; }
  .page { gap: 0.7rem !important; }
  .panel, .stat, .columns section { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; border-color: #d1d5db !important; }
  .columns { display: block !important; }
  .columns section { margin-bottom: 0.7rem; }
  .stats { grid-template-columns: repeat(3, 1fr) !important; }
  thead { display: table-header-group; }
  tr, .finance div { break-inside: avoid; page-break-inside: avoid; }
}
</style>
