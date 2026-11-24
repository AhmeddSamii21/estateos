<template>
  <div class="page">
    <router-link to="/leads" class="back">{{ store.isArabic ? '→' : '←' }} {{ store.isArabic ? 'العودة للعملاء المحتملين' : 'Back to leads' }}</router-link>

    <div v-if="error" class="state error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!lead" class="state">{{ store.isArabic ? 'العميل المحتمل غير موجود.' : 'Lead not found.' }}</div>

    <template v-else>
      <header class="hero">
        <div>
          <span class="badge">{{ label(lead.status) }}</span>
          <h1>{{ fullName }}</h1>
          <p class="muted">{{ lead.email || lead.phone || '—' }}</p>
        </div>
        <div class="hero-actions">
          <span class="tag" v-if="lead.priorityTier">{{ label(lead.priorityTier) }}</span>
        </div>
      </header>

      <section class="panel">
        <h2>{{ store.isArabic ? 'تفاصيل العميل' : 'Lead details' }}</h2>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'الحالة' : 'Status' }}</dt><dd>{{ label(lead.status) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المصدر' : 'Source' }}</dt><dd>{{ lead.source || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'البريد' : 'Email' }}</dt><dd>{{ lead.email || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الهاتف' : 'Phone' }}</dt><dd>{{ lead.phone || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المدينة المفضلة' : 'Preferred city' }}</dt><dd>{{ lead.preferredCity || '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'نوع العقار' : 'Property type' }}</dt><dd>{{ label(lead.preferredType) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الميزانية' : 'Budget' }}</dt><dd>{{ budget }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المتابعة التالية' : 'Next follow-up' }}</dt><dd>{{ formatDate(lead.nextFollowUpAt) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'آخر تواصل' : 'Last contacted' }}</dt><dd>{{ formatDate(lead.lastContactedAt) }}</dd></div>
        </dl>
        <p v-if="lead.notes" class="description">{{ lead.notes }}</p>
      </section>

      <ClientPortalPanel entity-type="Lead" :entity-id="lead.id" />

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'الملاحظات والمتابعات' : 'Notes and follow-ups' }}</h2>
          <span class="muted">{{ lead.followUpNotes?.length || 0 }}</span>
        </div>
        <div v-if="!lead.followUpNotes?.length" class="empty">
          {{ store.isArabic ? 'لا توجد متابعات مسجلة.' : 'No follow-up notes recorded.' }}
        </div>
        <ul v-else class="notes">
          <li v-for="note in lead.followUpNotes" :key="note.id">
            <span class="muted">{{ formatDate(note.createdAt) }} · {{ note.author?.firstName || note.author?.email || '—' }}</span>
            <p>{{ note.body }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import ClientPortalPanel from '@/components/ClientPortalPanel.vue'
import { apiGet, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { Lead } from '@/types'

const route = useRoute()
const store = useStore()
const lead = ref<Lead | null>(null)
const loading = ref(true)
const error = ref('')

const fullName = computed(() => `${lead.value?.firstName || ''} ${lead.value?.lastName || ''}`.trim() || '—')
const budget = computed(() => {
  const min = money(lead.value?.budgetMin)
  const max = money(lead.value?.budgetMax)
  return min === '—' && max === '—' ? '—' : `${min} – ${max}`
})

const LABELS: Record<string, [string, string]> = {
  NEW: ['New', 'جديد'],
  CONTACTED: ['Contacted', 'تم التواصل'],
  QUALIFIED: ['Qualified', 'مؤهل'],
  UNQUALIFIED: ['Unqualified', 'غير مؤهل'],
  CONVERTED: ['Converted', 'محوّل'],
  LOST: ['Lost', 'مفقود'],
  LOW: ['Low', 'منخفض'],
  MEDIUM: ['Medium', 'متوسط'],
  HIGH: ['High', 'مرتفع'],
  URGENT: ['Urgent', 'عاجل'],
  APARTMENT: ['Apartment', 'شقة'],
  VILLA: ['Villa', 'فيلا'],
  HOUSE: ['House', 'منزل'],
  LAND: ['Land', 'أرض'],
  COMMERCIAL: ['Commercial', 'تجاري']
}

function label(value: string | null | undefined): string {
  if (!value) return '—'
  const pair = LABELS[value]
  return pair ? (store.isArabic ? pair[1] : pair[0]) : value.replaceAll('_', ' ').toLowerCase()
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toLocaleString(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-US') : '—'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar-EG-u-nu-latn' : 'en-GB')
}

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await apiGet<Lead>(`/leads/${String(route.params.id || '')}`)
    lead.value = response.data
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.back { color: #4f46e5; text-decoration: none; font-size: 0.85rem; }
.hero, .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 1.2rem; }
.hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.hero h1 { margin: 0.4rem 0; font-size: 1.6rem; }
.badge, .tag { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.72rem; font-weight: 700; }
.muted { color: #6b7280; font-size: 0.82rem; }
.state, .empty { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.5rem; color: #6b7280; text-align: center; }
.error { color: #991b1b; }
h2 { margin: 0 0 0.8rem; font-size: 1.05rem; }
.panel-head { display: flex; justify-content: space-between; gap: 1rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; margin: 0; }
.facts div { background: #f9fafb; border-radius: 8px; padding: 0.6rem; }
.facts dt { color: #6b7280; font-size: 0.7rem; }
.facts dd { margin: 0; font-weight: 600; font-size: 0.88rem; }
.description { line-height: 1.65; white-space: pre-wrap; }
.notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.notes li { border: 1px solid #eef2f7; border-radius: 10px; padding: 0.7rem; }
.notes p { margin: 0.3rem 0 0; }
@media (max-width: 768px) {
  .hero { flex-direction: column; }
}
</style>
