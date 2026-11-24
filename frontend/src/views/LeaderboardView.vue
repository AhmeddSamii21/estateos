<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'لوحة حصص المبيعات' : 'Sales quota leaderboard' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'ترتيب الأداء مقابل الحصة الشهرية المضاعفة حسب الفترة.'
            : 'Performance ranked against monthly targets scaled by the selected period.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <select v-model="period" :aria-label="store.isArabic ? 'الفترة' : 'Period'" @change="load">
          <option value="month">{{ store.isArabic ? 'شهري' : 'Monthly' }}</option>
          <option value="quarter">{{ store.isArabic ? 'ربع سنوي' : 'Quarterly' }}</option>
          <option value="year">{{ store.isArabic ? 'سنوي' : 'Yearly' }}</option>
        </select>
        <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
          <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
        </button>
        <button class="btn btn-quiet" type="button" :disabled="!rows.length" @click="onExport">
          <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
        </button>
        <button class="btn btn-quiet" type="button" @click="onPrint">
          <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة' : 'Print' }}
        </button>
      </div>
    </div>

    <div class="print-only print-brand">
      <strong>EstateOS</strong>
      <h1>{{ store.isArabic ? 'لوحة حصص المبيعات' : 'Sales quota leaderboard' }}</h1>
      <p>{{ periodLabel }} · {{ rangeLabel }}</p>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!rows.length" class="empty">
      {{ store.isArabic ? 'لا توجد بيانات أداء للفترة المحددة.' : 'No performance data for this period.' }}
    </div>
    <template v-else>
      <section class="stats">
        <article class="stat">
          <span>{{ store.isArabic ? 'إجمالي المحقق' : 'Total achieved' }}</span>
          <strong>{{ totalAchieved }}</strong>
        </article>
        <article class="stat">
          <span>{{ store.isArabic ? 'إجمالي الأهداف' : 'Total targets' }}</span>
          <strong>{{ totalTarget }}</strong>
        </article>
        <article class="stat">
          <span>{{ store.isArabic ? 'متوسط الإنجاز' : 'Average attainment' }}</span>
          <strong>{{ averageAttainment }}%</strong>
        </article>
      </section>

      <section class="panel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
              <th>{{ store.isArabic ? 'الدور' : 'Role' }}</th>
              <th>{{ store.isArabic ? 'الهدف' : 'Target' }}</th>
              <th>{{ store.isArabic ? 'المحقق' : 'Achieved' }}</th>
              <th>{{ store.isArabic ? 'الإنجاز' : 'Attainment' }}</th>
              <th>{{ store.isArabic ? 'الصفقات' : 'Deals' }}</th>
              <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.userId">
              <td><strong>{{ row.rank }}</strong></td>
              <td>{{ row.name }}</td>
              <td>{{ row.role }}</td>
              <td>{{ row.target ?? '—' }}</td>
              <td><strong>{{ Number(row.value).toLocaleString() }}</strong></td>
              <td>
                <div class="progress" :aria-label="`${store.isArabic ? 'الإنجاز' : 'Attainment'}: ${row.attainment ?? 0}%`">
                  <div class="progress-fill" :style="{ width: `${Math.min(100, Math.max(0, row.attainment ?? 0))}%` }"></div>
                  <span>{{ row.attainment === null ? '—' : `${row.attainment}%` }}</span>
                </div>
              </td>
              <td>{{ row.dealCount }}</td>
              <td><span class="status-pill" :class="`quota-${row.status.toLowerCase()}`">{{ statusLabel(row.status) }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiGet, errorMessage } from '@/api/client'
import { leaderboardCsv } from '@/utils/leaderboardCore.mjs'
import { useStore } from '@/stores'

interface LeaderboardRow {
  userId: string
  name: string
  role: string
  target: string | null
  value: string
  attainment: number | null
  status: 'NO_TARGET' | 'BELOW' | 'NEAR' | 'ON_TRACK' | 'EXCEEDED'
  dealCount: number
  wonLeadCount: number
  completedAppointmentCount: number
  rank: number
}
interface LeaderboardResponse {
  period: string
  from: string
  to: string
  scope: string
  rows: LeaderboardRow[]
}

const store = useStore()
const period = ref<'month' | 'quarter' | 'year'>('month')
const rows = ref<LeaderboardRow[]>([])
const meta = ref<LeaderboardResponse | null>(null)
const loading = ref(false)
const error = ref('')

const periodLabel = computed(() => ({
  month: store.isArabic ? 'شهري' : 'Monthly',
  quarter: store.isArabic ? 'ربع سنوي' : 'Quarterly',
  year: store.isArabic ? 'سنوي' : 'Yearly'
}[period.value]))

const rangeLabel = computed(() => meta.value
  ? `${new Date(meta.value.from).toLocaleDateString()} — ${new Date(meta.value.to).toLocaleDateString()}`
  : '')

const totalAchieved = computed(() => rows.value.reduce((sum, row) => sum + Number(row.value), 0).toLocaleString())
const totalTarget = computed(() => rows.value.reduce((sum, row) => sum + Number(row.target || 0), 0).toLocaleString())
const averageAttainment = computed(() => {
  const withTarget = rows.value.filter((row) => row.attainment !== null)
  if (!withTarget.length) return '0'
  return (withTarget.reduce((sum, row) => sum + (row.attainment || 0), 0) / withTarget.length).toFixed(1)
})

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await apiGet<LeaderboardResponse>('/leaderboard', { params: { period: period.value } })
    meta.value = response.data
    rows.value = response.data?.rows || []
  } catch (caught) {
    error.value = errorMessage(caught)
    rows.value = []
  } finally {
    loading.value = false
  }
}

function statusLabel(status: LeaderboardRow['status']): string {
  const labels: Record<LeaderboardRow['status'], [string, string]> = {
    NO_TARGET: ['No target', 'بلا هدف'],
    BELOW: ['Below', 'أقل من المستهدف'],
    NEAR: ['Near', 'قريب'],
    ON_TRACK: ['On track', 'في المسار'],
    EXCEEDED: ['Exceeded', 'تجاوز الهدف']
  }
  return store.isArabic ? labels[status][1] : labels[status][0]
}

function onExport(): void {
  const csv = leaderboardCsv(rows.value, store.isArabic ? 'ar' : 'en')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `leaderboard-${period.value}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function onPrint(): void {
  window.print()
}
</script>
