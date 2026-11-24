<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'سجل التدقيق' : 'Audit explorer' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'الأحداث المسجلة فعلياً على سجلات مؤسستك، مع تصفية وتصدير آمنين.'
            : 'Persisted events across your organization’s records, with safe filtering and export.' }}
        </p>
      </div>
      <button class="btn btn-quiet" type="button" :disabled="exporting" @click="onExport">
        <i class="fas fa-download"></i>
        {{ exporting ? '…' : (store.isArabic ? 'تصدير CSV' : 'Export CSV') }}
      </button>
    </div>

    <section class="card">
      <div class="filters">
        <label>
          <span>{{ store.isArabic ? 'الكيان' : 'Entity' }}</span>
          <select v-model="filters.entityType">
            <option value="">{{ store.isArabic ? 'كل الكيانات' : 'All entities' }}</option>
            <option v-for="type in entityTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'الإجراء' : 'Action' }}</span>
          <input v-model="filters.action" maxlength="100" placeholder="DEAL_STATUS_CHANGED" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'المستخدم' : 'Actor' }}</span>
          <input v-model="filters.actor" maxlength="200" :placeholder="store.isArabic ? 'الاسم أو البريد' : 'Name or email'" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'من' : 'From' }}</span>
          <input v-model="filters.from" type="date" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'إلى' : 'To' }}</span>
          <input v-model="filters.to" type="date" />
        </label>
        <button class="btn btn-primary align-end" type="button" :disabled="loading" @click="onApply">
          {{ store.isArabic ? 'تطبيق' : 'Apply' }}
        </button>
        <button class="btn btn-quiet align-end" type="button" :disabled="loading" @click="onReset">
          {{ store.isArabic ? 'إعادة تعيين' : 'Reset' }}
        </button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>

    <section class="card">
      <div v-if="loading && !entries.length" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
      <div v-else-if="!entries.length" class="state">
        {{ store.isArabic ? 'لا توجد أحداث مطابقة.' : 'No matching audit events.' }}
      </div>
      <div v-else class="entries">
        <article v-for="entry in entries" :key="entry.id" class="entry">
          <div class="entry-head">
            <strong>{{ entry.action }}</strong>
            <span class="tag">{{ entry.entityType }}</span>
            <time :datetime="entry.timestamp">{{ formatDate(entry.timestamp) }}</time>
          </div>
          <p class="entity">
            <router-link v-if="entry.entity.href" :to="entry.entity.href">{{ entry.entity.label }}</router-link>
            <span v-else>{{ entry.entity.label }}</span>
          </p>
          <small class="muted">{{ actorLabel(entry) }}</small>
          <pre v-if="Object.keys(entry.metadata).length" class="metadata">{{ JSON.stringify(entry.metadata) }}</pre>
        </article>
      </div>
      <div class="pager">
        <span class="muted">{{ entries.length }} {{ store.isArabic ? 'حدث' : 'events' }}</span>
        <button v-if="nextCursor" class="btn btn-quiet" type="button" :disabled="loading" @click="loadMore">
          {{ store.isArabic ? 'تحميل المزيد' : 'Load more' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiGet, demoFetch, errorMessage, tokenStore } from '@/api/client'
import { useStore } from '@/stores'
import type { ActivityEntry } from '@/types'

const ENTITY_TYPES = [
  'Property', 'Owner', 'Lead', 'Deal', 'Payment', 'Expense',
  'Appointment', 'MaintenanceRequest', 'Document', 'Commission', 'OwnerPayout'
]

const store = useStore()
const entityTypes = ENTITY_TYPES
const filters = reactive({ entityType: '', action: '', actor: '', from: '', to: '' })
const entries = ref<ActivityEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')

function queryParams(): Record<string, string> {
  const params: Record<string, string> = { limit: '25' }
  if (filters.entityType) params.entityType = filters.entityType
  if (filters.action) params.action = filters.action.trim()
  if (filters.actor) params.actor = filters.actor.trim()
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return params
}

async function load(reset: boolean): Promise<void> {
  loading.value = true
  error.value = ''
  const params = queryParams()
  if (!reset && nextCursor.value) params.cursor = nextCursor.value
  try {
    const response = await apiGet<ActivityEntry[]>('/activity', { params })
    entries.value = reset ? response.data : [...entries.value, ...response.data]
    nextCursor.value = response.nextCursor || null
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

function onApply(): void { void load(true) }
function onReset(): void {
  filters.entityType = ''
  filters.action = ''
  filters.actor = ''
  filters.from = ''
  filters.to = ''
  void load(true)
}
function loadMore(): void { void load(false) }

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar-SA' : 'en-US')
}

function actorLabel(entry: ActivityEntry): string {
  if (!entry.actor) return store.isArabic ? 'مستخدم محذوف' : 'Deleted user'
  return entry.actor.firstName
    ? `${entry.actor.firstName} (${entry.actor.email})`
    : entry.actor.email
}

async function onExport(): Promise<void> {
  exporting.value = true
  error.value = ''
  try {
    const token = tokenStore.get()
    const params = new URLSearchParams(queryParams())
    const response = await demoFetch(`/api/activity/export?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!response.ok) throw new Error(store.isArabic ? 'تعذّر تصدير السجل.' : 'Audit export failed.')
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'activity.csv'
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    exporting.value = false
  }
}

onMounted(() => { void load(true) })
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; font-size: 0.8rem; margin: 0; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem 1.2rem; }
.filters { display: flex; gap: 0.7rem; align-items: end; flex-wrap: wrap; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.76rem; color: #374151; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; font-family: inherit; }
.btn { border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.84rem; cursor: pointer; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.align-end { align-self: end; }
.error { color: #991b1b; background: #fef2f2; border-radius: 8px; padding: 0.5rem 0.7rem; margin: 0.8rem 0 0; font-size: 0.82rem; }
.state { padding: 2rem; text-align: center; color: #6b7280; }
.entries { display: flex; flex-direction: column; }
.entry { padding: 0.9rem 0; border-bottom: 1px solid #f3f4f6; }
.entry-head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.entry-head strong { font-size: 0.86rem; }
.entry-head time { margin-inline-start: auto; color: #6b7280; font-size: 0.75rem; }
.tag { background: #e0e7ff; color: #3730a3; border-radius: 999px; padding: 0.1rem 0.45rem; font-size: 0.68rem; }
.entity { margin: 0.4rem 0 0.2rem; font-size: 0.88rem; }
.entity a { color: #4338ca; text-decoration: none; }
.metadata { margin: 0.5rem 0 0; padding: 0.55rem; border-radius: 6px; background: #f8fafc; font-size: 0.72rem; overflow-x: auto; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding-top: 0.9rem; }
</style>
