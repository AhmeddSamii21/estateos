<template>
  <div class="public-page">
    <header class="public-head">
      <span class="badge">{{ store.isArabic ? 'بوابة المالك' : 'Owner portal' }}</span>
      <h1>{{ data?.owner.displayName || (store.isArabic ? 'ملخص المالك' : 'Owner summary') }}</h1>
      <p v-if="data?.owner.organizationName" class="organization">{{ data.owner.organizationName }}</p>
    </header>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="error" class="state error" role="alert">
      <h2>{{ store.isArabic ? 'الرابط غير متاح' : 'Link unavailable' }}</h2>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="data">
      <section class="summary-cards">
        <div class="summary-card">
          <span>{{ store.isArabic ? 'العقارات' : 'Properties' }}</span>
          <strong>{{ data.summary.properties }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ store.isArabic ? 'الصفقات' : 'Deals' }}</span>
          <strong>{{ data.summary.deals }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ store.isArabic ? 'المدينة' : 'City' }}</span>
          <strong class="text-value">{{ [data.owner.city, data.owner.country].filter(Boolean).join(', ') || '—' }}</strong>
        </div>
      </section>

      <section class="card">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'محفظة العقارات' : 'Property portfolio' }}</h2>
          <span class="muted">{{ store.isArabic ? 'عرض للقراءة فقط' : 'Read-only overview' }}</span>
        </div>
        <div v-if="!data.properties.length" class="empty">
          {{ store.isArabic ? 'لا توجد عقارات مرتبطة حالياً.' : 'No properties are currently linked.' }}
        </div>
        <div v-else class="property-list">
          <article v-for="property in data.properties" :key="property.referenceNumber" class="property">
            <div class="property-head">
              <div>
                <span class="reference">{{ property.referenceNumber }}</span>
                <h3>{{ property.title }}</h3>
              </div>
              <strong class="price">{{ money(property.price, property.currency) }}</strong>
            </div>
            <p class="location">
              <i class="fas fa-location-dot"></i>
              {{ [property.address, property.city, property.state, property.country].filter(Boolean).join(', ') || '—' }}
            </p>
            <p class="tags">
              <span class="tag">{{ label(property.classification) }}</span>
              <span class="tag">{{ label(property.type) }}</span>
              <span class="tag">{{ label(property.status) }}</span>
              <span v-if="property.negotiable" class="tag">{{ store.isArabic ? 'قابل للتفاوض' : 'Negotiable' }}</span>
            </p>
            <dl class="facts">
              <div><dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt><dd>{{ property.bedrooms }}</dd></div>
              <div><dt>{{ store.isArabic ? 'الحمامات' : 'Bathrooms' }}</dt><dd>{{ property.bathrooms }}</dd></div>
              <div><dt>{{ store.isArabic ? 'المساحة' : 'Area' }}</dt><dd>{{ property.area ?? '—' }} {{ property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²' }}</dd></div>
              <div><dt>{{ store.isArabic ? 'سنة البناء' : 'Year built' }}</dt><dd>{{ property.yearBuilt ?? '—' }}</dd></div>
              <div><dt>{{ store.isArabic ? 'متاح من' : 'Available from' }}</dt><dd>{{ formatDate(property.availableFrom) }}</dd></div>
            </dl>
            <p v-if="property.description" class="description">{{ property.description }}</p>
          </article>
        </div>
      </section>

      <section v-if="dealStatusEntries.length" class="card">
        <h2>{{ store.isArabic ? 'حالة الصفقات' : 'Deal status' }}</h2>
        <ul class="deal-statuses">
          <li v-for="[status, count] in dealStatusEntries" :key="status">
            <span>{{ label(status) }}</span>
            <strong>{{ count }}</strong>
          </li>
        </ul>
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
import type { PublicOwnerPortal } from '@/types'

const route = useRoute()
const store = useStore()
const data = ref<PublicOwnerPortal | null>(null)
const loading = ref(true)
const error = ref('')
const token = computed(() => String(route.params.token || ''))

const dealStatusEntries = computed(() => Object.entries(data.value?.summary.dealStatuses || {}).sort(([a], [b]) => a.localeCompare(b)))

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
  EXCELLENT: ['Excellent', 'ممتاز'],
  GOOD: ['Good', 'جيد'],
  FAIR: ['Fair', 'مقبول'],
  POOR: ['Poor', 'ضعيف'],
  DRAFT: ['Draft', 'مسودة'],
  ACTIVE: ['Active', 'نشط'],
  COMPLETED: ['Completed', 'مكتمل'],
  CANCELLED: ['Cancelled', 'ملغي']
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
    const response = await fetch(`/api/public/owner-portal/${encodeURIComponent(token.value)}`)
    if (!response.ok) throw new Error(store.isArabic ? 'الرابط غير صالح أو تم إلغاؤه.' : 'This link is invalid or has been revoked.')
    const body = await response.json() as { success?: boolean; data?: PublicOwnerPortal; error?: { message?: string } }
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
h3 { margin: 0; font-size: 1rem; }
.organization, .muted { margin: 0; color: #6b7280; font-size: 0.85rem; }
.state, .empty { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 2rem; text-align: center; color: #6b7280; }
.state.error h2 { color: #991b1b; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; gap: 1rem; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; }
.summary-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; }
.summary-card span { color: #6b7280; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; }
.summary-card strong { color: #4338ca; font-size: 1.35rem; }
.summary-card .text-value { font-size: 0.95rem; color: #374151; }
.property-list { display: flex; flex-direction: column; gap: 0.9rem; }
.property { border: 1px solid #eef2f7; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
.property-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.reference { color: #6b7280; font-size: 0.72rem; letter-spacing: 0.04em; }
.price { color: #4338ca; white-space: nowrap; }
.location { margin: 0; color: #6b7280; font-size: 0.82rem; }
.tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; }
.tag { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0.2rem 0.55rem; font-size: 0.7rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.5rem; margin: 0; }
.facts div { background: #f9fafb; border-radius: 8px; padding: 0.5rem 0.6rem; }
.facts dt { color: #6b7280; font-size: 0.7rem; }
.facts dd { margin: 0; font-weight: 600; font-size: 0.86rem; }
.description { margin: 0; font-size: 0.86rem; line-height: 1.65; white-space: pre-wrap; }
.deal-statuses { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.6rem; }
.deal-statuses li { background: #f9fafb; border-radius: 8px; padding: 0.45rem 0.7rem; display: flex; gap: 0.5rem; font-size: 0.82rem; }
.public-foot { color: #6b7280; font-size: 0.78rem; text-align: center; }
@media (max-width: 640px) { .property-head { flex-direction: column; } }
</style>
