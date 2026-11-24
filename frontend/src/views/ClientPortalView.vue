<template>
  <div class="public-page">
    <header class="public-head">
      <span class="badge">{{ store.isArabic ? 'بوابة العميل' : 'Client portal' }}</span>
      <h1>{{ data?.client.displayName || (store.isArabic ? 'ملخص العميل' : 'Client summary') }}</h1>
      <p v-if="data?.client.organizationName" class="organization">{{ data.client.organizationName }}</p>
    </header>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="error" class="state error" role="alert">
      <h2>{{ store.isArabic ? 'الرابط غير متاح' : 'Link unavailable' }}</h2>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="data">
      <section class="summary-cards">
        <div class="summary-card">
          <span>{{ store.isArabic ? 'العقار' : 'Property' }}</span>
          <strong class="text-value">{{ data.property?.title || '—' }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ store.isArabic ? 'حالة الصفقة' : 'Deal status' }}</span>
          <strong class="text-value">{{ label(primaryDeal?.status || data.lead?.status) }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ store.isArabic ? 'المتبقي' : 'Outstanding' }}</span>
          <strong>{{ money(primaryDeal?.summary.outstanding || '0', primaryDeal?.currency) }}</strong>
        </div>
      </section>

      <section v-if="data.lead" class="card">
        <h2>{{ store.isArabic ? 'الاهتمامات' : 'Client interests' }}</h2>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'الحالة' : 'Status' }}</dt><dd>{{ label(data.lead.status) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المدينة المفضلة' : 'Preferred city' }}</dt><dd>{{ data.lead.preferredCity || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'نوع العقار' : 'Property type' }}</dt><dd>{{ label(data.lead.preferredType) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt><dd>{{ data.lead.preferredBedrooms ?? '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الميزانية' : 'Budget' }}</dt><dd>{{ budget }}</dd></div>
        </dl>
      </section>

      <section v-if="data.property" class="card">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'تفاصيل العقار' : 'Property details' }}</h2>
          <span class="muted">{{ store.isArabic ? 'عرض للقراءة فقط' : 'Read-only overview' }}</span>
        </div>
        <div class="property-head">
          <div>
            <span class="reference">{{ data.property.referenceNumber }}</span>
            <h3>{{ data.property.title }}</h3>
          </div>
          <strong class="price">{{ money(data.property.price, data.property.currency) }}</strong>
        </div>
        <p class="location">
          <i class="fas fa-location-dot"></i>
          {{ location }}
        </p>
        <p class="tags">
          <span class="tag">{{ label(data.property.classification) }}</span>
          <span class="tag">{{ label(data.property.type) }}</span>
          <span class="tag">{{ label(data.property.status) }}</span>
        </p>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt><dd>{{ data.property.bedrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الحمامات' : 'Bathrooms' }}</dt><dd>{{ data.property.bathrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المساحة' : 'Area' }}</dt><dd>{{ data.property.area ?? '—' }} {{ data.property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'سنة البناء' : 'Year built' }}</dt><dd>{{ data.property.yearBuilt ?? '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'متاح من' : 'Available from' }}</dt><dd>{{ formatDate(data.property.availableFrom) }}</dd></div>
        </dl>
        <p v-if="data.property.description" class="description">{{ data.property.description }}</p>
      </section>

      <section v-if="primaryDeal" class="card">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'ملخص الصفقة والمدفوعات' : 'Deal and payment summary' }}</h2>
          <span class="tag">{{ label(primaryDeal.status) }}</span>
        </div>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'رقم الصفقة' : 'Reference' }}</dt><dd>{{ primaryDeal.referenceNumber || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'النوع' : 'Type' }}</dt><dd>{{ label(primaryDeal.type) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</dt><dd>{{ money(primaryDeal.amount, primaryDeal.currency) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الاستحقاق' : 'Due' }}</dt><dd>{{ formatDate(primaryDeal.dueAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المسدد' : 'Paid' }}</dt><dd>{{ money(primaryDeal.summary.paid, primaryDeal.currency) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المتبقي' : 'Outstanding' }}</dt><dd>{{ money(primaryDeal.summary.outstanding, primaryDeal.currency) }}</dd></div>
        </dl>

        <h3>{{ store.isArabic ? 'جدول المدفوعات' : 'Payment schedule' }}</h3>
        <div v-if="!primaryDeal.payments.length" class="empty">
          {{ store.isArabic ? 'لا توجد مدفوعات مسجلة حالياً.' : 'No payments are currently recorded.' }}
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ store.isArabic ? 'الاستحقاق' : 'Due date' }}</th>
                <th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th>
                <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
                <th>{{ store.isArabic ? 'تاريخ السداد' : 'Paid at' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(payment, index) in primaryDeal.payments" :key="`${payment.reference || 'payment'}-${index}`">
                <td>{{ formatDate(payment.dueAt) }}</td>
                <td>{{ money(payment.amount, payment.currency) }}</td>
                <td>{{ label(payment.status) }}</td>
                <td>{{ formatDate(payment.paidAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="data.deals.length" class="card">
        <h2>{{ store.isArabic ? 'صفقات أخرى مرتبطة' : 'Other linked deals' }}</h2>
        <div class="deal-list">
          <article v-for="(deal, index) in data.deals" :key="`${deal.referenceNumber || 'deal'}-${index}`" class="deal-row">
            <div>
              <span class="reference">{{ deal.referenceNumber || deal.property?.referenceNumber }}</span>
              <strong>{{ deal.property?.title || '—' }}</strong>
            </div>
            <span class="tag">{{ label(deal.status) }}</span>
            <strong>{{ money(deal.amount, deal.currency) }}</strong>
          </article>
        </div>
      </section>

      <footer class="public-foot">
        {{ store.isArabic ? 'هذه الصفحة للعرض فقط ولا تسمح بأي تعديل.' : 'This page is read-only and does not allow changes.' }}
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useStore } from '@/stores'
import { demoFetch } from '@/api/client'
import type { ClientPortalDeal, PublicClientPortal } from '@/types'

const route = useRoute()
const store = useStore()
const data = ref<PublicClientPortal | null>(null)
const loading = ref(true)
const error = ref('')
const token = computed(() => String(route.params.token || ''))

const primaryDeal = computed<ClientPortalDeal | null>(() => data.value?.deal || data.value?.deals[0] || null)
const location = computed(() => [
  data.value?.property?.address,
  data.value?.property?.city,
  data.value?.property?.state,
  data.value?.property?.country
].filter(Boolean).join(', ') || '—')
const budget = computed(() => {
  const lead = data.value?.lead
  if (!lead) return '—'
  const currency = data.value?.property?.currency || 'USD'
  return `${money(lead.budgetMin, currency)} – ${money(lead.budgetMax, currency)}`
})

const LABELS: Record<string, [string, string]> = {
  AVAILABLE: ['Available', 'متاحة'],
  UNDER_NEGOTIATION: ['Under negotiation', 'قيد التفاوض'],
  PENDING: ['Pending', 'قيد الانتظار'],
  RESERVED: ['Reserved', 'محجوزة'],
  SOLD: ['Sold', 'مباعة'],
  RENTED: ['Rented', 'مؤجرة'],
  OFF_MARKET: ['Off market', 'خارج السوق'],
  UNAVAILABLE: ['Unavailable', 'غير متاحة'],
  HOUSE: ['House', 'منزل'],
  APARTMENT: ['Apartment', 'شقة'],
  CONDO: ['Condo', 'شقة مملوكة'],
  TOWNHOUSE: ['Townhouse', 'منزل متصل'],
  VILLA: ['Villa', 'فيلا'],
  LAND: ['Land', 'أرض'],
  COMMERCIAL: ['Commercial', 'تجاري'],
  RESIDENTIAL: ['Residential', 'سكني'],
  SALE: ['Sale', 'بيع'],
  RENT: ['Rent', 'إيجار'],
  NEW: ['New', 'جديد'],
  CONTACTED: ['Contacted', 'تم التواصل'],
  QUALIFIED: ['Qualified', 'مؤهل'],
  DRAFT: ['Draft', 'مسودة'],
  ACTIVE: ['Active', 'نشط'],
  COMPLETED: ['Completed', 'مكتمل'],
  CANCELLED: ['Cancelled', 'ملغي'],
  PAID: ['Paid', 'مدفوع'],
  COMPLETED: ['Completed', 'مكتمل'],
  FAILED: ['Failed', 'فشل'],
  REFUNDED: ['Refunded', 'مسترد'],
  PARTIAL: ['Partial', 'جزئي'],
  OVERDUE: ['Overdue', 'متأخر']
}

function label(value: string | null | undefined): string {
  if (!value) return '—'
  const pair = LABELS[value]
  return pair ? (store.isArabic ? pair[1] : pair[0]) : value.replaceAll('_', ' ').toLowerCase()
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-GB')
}

function money(value: string | number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency || ''}`.trim()
  }
}

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await demoFetch(`/api/public/client-portal/${encodeURIComponent(token.value)}`)
    if (!response.ok) throw new Error(store.isArabic ? 'الرابط غير صالح أو تم إلغاؤه.' : 'This link is invalid or has been revoked.')
    const body = await response.json() as { success?: boolean; data?: PublicClientPortal; error?: { message?: string } }
    if (!body.success || !body.data) throw new Error(body.error?.message || (store.isArabic ? 'الرابط غير متاح' : 'Link unavailable'))
    data.value = body.data
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : (store.isArabic ? 'الرابط غير متاح' : 'Link unavailable')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.public-page { max-width: 980px; margin: 0 auto; padding: 2rem 1rem 3rem; display: flex; flex-direction: column; gap: 1rem; }
.public-head { display: flex; flex-direction: column; gap: 0.35rem; }
.badge { align-self: flex-start; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.74rem; font-weight: 700; }
h1 { margin: 0; font-size: 1.7rem; }
h2 { margin: 0; font-size: 1.05rem; }
h3 { margin: 0.9rem 0 0; font-size: 0.95rem; }
.organization, .muted { margin: 0; color: #6b7280; font-size: 0.85rem; }
.state, .empty { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 2rem; text-align: center; color: #6b7280; }
.state.error h2 { color: #991b1b; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; }
.summary-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; }
.summary-card span { color: #6b7280; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; }
.summary-card strong { color: #4338ca; font-size: 1.15rem; }
.summary-card .text-value { color: #374151; font-size: 0.95rem; }
.property-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.reference { color: #6b7280; font-size: 0.72rem; letter-spacing: 0.04em; }
.price { color: #4338ca; white-space: nowrap; }
.location { margin: 0; color: #6b7280; font-size: 0.82rem; }
.tags, .deal-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.tag { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0.2rem 0.55rem; font-size: 0.7rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; margin: 0; }
.facts div { background: #f9fafb; border-radius: 8px; padding: 0.5rem 0.6rem; }
.facts dt { color: #6b7280; font-size: 0.7rem; }
.facts dd { margin: 0; font-weight: 600; font-size: 0.86rem; }
.description { margin: 0; font-size: 0.86rem; line-height: 1.65; white-space: pre-wrap; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th, td { text-align: start; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; }
th { color: #6b7280; font-size: 0.72rem; text-transform: uppercase; }
.deal-list { flex-direction: column; }
.deal-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; border: 1px solid #eef2f7; border-radius: 10px; padding: 0.65rem 0.8rem; flex-wrap: wrap; }
.deal-row > div { display: flex; flex-direction: column; }
.public-foot { color: #6b7280; font-size: 0.78rem; text-align: center; }
@media (max-width: 768px) {
  .property-head { flex-direction: column; }
  .deal-row { flex-direction: column; align-items: flex-start; }
}
</style>
