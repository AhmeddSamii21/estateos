<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'لوحة التحكم' : 'Dashboard' }}</h1>
        <p class="muted">{{ store.isArabic ? 'نظرة عامة على محفظة العقارات' : 'Overview of your property portfolio' }}</p>
      </div>
      <router-link class="btn btn-primary" to="/properties/new">
        <i class="fas fa-plus"></i> {{ store.isArabic ? 'عقار جديد' : 'New property' }}
      </router-link>
    </div>

    <div v-if="store.loading && !store.allProperties.length" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>

    <template v-else>
      <section class="stats">
        <article v-for="card in cards" :key="card.label" class="stat">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value" :class="{ 'stat-value-money': card.money }">{{ card.value }}</strong>
          <span class="stat-hint">{{ card.hint }}</span>
        </article>
      </section>
      <p class="fx-note">
        {{ store.isArabic
          ? 'يتم تجميع المجاميع حسب العملة المسجلة دون أي تحويل بين العملات.'
          : 'Totals are grouped by recorded currency; no FX conversion is applied.' }}
      </p>

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'أحدث العقارات' : 'Latest properties' }}</h2>
          <router-link to="/properties">{{ store.isArabic ? 'عرض الكل' : 'View all' }} →</router-link>
        </div>
        <div v-if="recent.length" class="rows">
          <router-link v-for="property in recent" :key="property.id" class="row" :to="`/properties/${property.id}`">
            <span class="ref">{{ property.referenceNumber }}</span>
            <span class="title">{{ property.title }}</span>
            <span class="tag">{{ property.status.replaceAll('_', ' ') }}</span>
            <strong>{{ money(property.price, property.currency) }}</strong>
          </router-link>
        </div>
        <div v-else class="state">
          {{ store.isArabic ? 'لا توجد عقارات بعد. أضف أول عقار للبدء.' : 'No properties yet. Add your first property to get started.' }}
        </div>
      </section>

      <section class="shortcuts">
        <router-link to="/leads"><i class="fas fa-user-plus"></i> {{ store.isArabic ? 'العملاء المحتملون' : 'Leads' }}</router-link>
        <router-link to="/appointments"><i class="fas fa-calendar"></i> {{ store.isArabic ? 'المواعيد' : 'Appointments' }}</router-link>
        <router-link to="/deals"><i class="fas fa-handshake"></i> {{ store.isArabic ? 'الصفقات' : 'Deals' }}</router-link>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useStore } from '@/stores'
import type { Property } from '@/types'

interface CurrencyTotal {
  currency: string
  total: number
  count: number
}

const store = useStore()

onMounted(() => {
  if (!store.allProperties.length) void store.fetchProperties({ limit: 100 })
})

const recent = computed(() => store.allProperties.slice(0, 6))
const available = computed(() => store.allProperties.filter((p) => p.status === 'AVAILABLE'))
const sold = computed(() => store.allProperties.filter((p) => p.status === 'SOLD'))

function normalizeCurrency(currency: string | null | undefined): string {
  return currency?.trim().toUpperCase() || 'UNSPECIFIED'
}

function groupByCurrency(properties: Property[]): CurrencyTotal[] {
  const grouped = new Map<string, CurrencyTotal>()
  for (const property of properties) {
    const currency = normalizeCurrency(property.currency)
    const current = grouped.get(currency) || { currency, total: 0, count: 0 }
    current.total += Number(property.price || 0)
    current.count += 1
    grouped.set(currency, current)
  }
  return Array.from(grouped.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

const portfolioByCurrency = computed(() => groupByCurrency(store.allProperties))
const soldByCurrency = computed(() => groupByCurrency(sold.value))

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
  return rows.map((row) => `${money(row.total, row.currency)} (${row.count})`).join(' · ')
}

const cards = computed(() => [
  { label: store.isArabic ? 'إجمالي العقارات' : 'Total properties', value: store.allProperties.length, hint: store.isArabic ? 'في قاعدة البيانات' : 'in the database', money: false },
  { label: store.isArabic ? 'متاحة' : 'Available', value: available.value.length, hint: store.isArabic ? 'جاهزة للعرض' : 'ready for viewing', money: false },
  { label: store.isArabic ? 'مباعة' : 'Sold', value: sold.value.length, hint: store.isArabic ? 'صفقات مكتملة' : 'closed deals', money: false },
  {
    label: store.isArabic ? 'قيمة المحفظة' : 'Portfolio value',
    value: breakdown(portfolioByCurrency.value),
    hint: store.isArabic ? 'مجمعة حسب العملة' : 'grouped by currency',
    money: true
  },
  {
    label: store.isArabic ? 'قيمة المبيعات' : 'Sold value',
    value: breakdown(soldByCurrency.value),
    hint: store.isArabic ? 'العقارات المباعة حسب العملة' : 'sold properties by currency',
    money: true
  }
])
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1.2rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0; font-size: 1.05rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: 8px; padding: 0.6rem 1rem; text-decoration: none; font-size: 0.88rem; }
.btn-primary { background: #4f46e5; color: #fff; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.9rem; }
.stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.stat-label { font-size: 0.78rem; color: #6b7280; }
.stat-value { font-size: 1.5rem; color: #312e81; }
.stat-value-money { font-size: 1rem; line-height: 1.35; }
.stat-hint { font-size: 0.72rem; color: #9ca3af; }
.fx-note { margin: -0.6rem 0 0; font-size: 0.75rem; color: #6b7280; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
.panel-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.2rem; border-bottom: 1px solid #eef2f7; }
.panel-head a { color: #4f46e5; font-size: 0.84rem; text-decoration: none; }
.rows { display: flex; flex-direction: column; }
.row { display: grid; grid-template-columns: 130px 1fr auto auto; gap: 0.8rem; align-items: center; padding: 0.8rem 1.2rem; border-bottom: 1px solid #f3f4f6; color: #374151; text-decoration: none; font-size: 0.88rem; }
.row:hover { background: #f9fafb; }
.ref { color: #6b7280; font-size: 0.78rem; }
.title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 0.72rem; background: #eef2ff; color: #4338ca; padding: 0.2rem 0.5rem; border-radius: 999px; }
.state { padding: 2rem; text-align: center; color: #6b7280; font-size: 0.9rem; }
.shortcuts { display: flex; gap: 0.8rem; flex-wrap: wrap; }
.shortcuts a { display: inline-flex; align-items: center; gap: 0.5rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 1rem; color: #374151; text-decoration: none; font-size: 0.86rem; }
@media (max-width: 600px) { .row { grid-template-columns: 1fr auto; } .ref, .tag { display: none; } }
</style>
