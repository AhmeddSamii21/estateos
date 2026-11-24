<template>
  <section class="activity-panel">
    <div class="panel-head">
      <h2>{{ store.isArabic ? 'سجل النشاط' : 'Activity timeline' }}</h2>
      <span v-if="total !== null" class="count">{{ total }}</span>
    </div>

    <form v-if="showFilters" class="filters" @submit.prevent="reload">
      <label>
        <span>{{ store.isArabic ? 'الكيان' : 'Entity' }}</span>
        <select v-if="!isEntityMode" v-model="filters.entityType">
          <option value="">{{ store.isArabic ? 'الكل' : 'All' }}</option>
          <option v-for="type in entityTypes" :key="type" :value="type">{{ entityLabel(type) }}</option>
        </select>
        <span v-else class="fixed-entity">{{ entityLabel(entityType) }}</span>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحدث' : 'Action' }}</span>
        <input v-model="filters.action" :placeholder="store.isArabic ? 'مثال: PROPERTY_CREATED' : 'e.g. PROPERTY_CREATED'" maxlength="100" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'المستخدم' : 'User ID' }}</span>
        <input v-model="filters.userId" maxlength="200" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'من' : 'From' }}</span>
        <input v-model="filters.from" type="date" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'إلى' : 'To' }}</span>
        <input v-model="filters.to" type="date" />
      </label>
      <button class="btn" type="submit" :disabled="loading">{{ store.isArabic ? 'تطبيق' : 'Apply' }}</button>
      <button class="btn quiet" type="button" :disabled="loading" @click="clearFilters">
        {{ store.isArabic ? 'مسح' : 'Clear' }}
      </button>
    </form>

    <div v-if="loading && !entries.length" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading activity…' }}</div>
    <div v-else-if="error" class="error" role="alert">{{ error }}</div>
    <div v-else-if="!entries.length" class="state">
      {{ store.isArabic ? 'لا يوجد نشاط مسجل.' : 'No activity recorded.' }}
    </div>

    <ol v-else class="timeline">
      <li v-for="entry in entries" :key="entry.id">
        <span class="marker" aria-hidden="true"><i class="fas fa-clock"></i></span>
        <div class="event-body">
          <div class="event-head">
            <strong>{{ actionLabel(entry.action) }}</strong>
            <time :datetime="entry.timestamp">{{ formatDate(entry.timestamp) }}</time>
          </div>
          <div class="event-entity">
            <span class="tag">{{ entityLabel(entry.entityType) }}</span>
            <router-link v-if="entry.entity.href" :to="entry.entity.href">{{ entry.entity.label }}</router-link>
            <span v-else>{{ entry.entity.label }}</span>
          </div>
          <p v-if="entry.actor" class="actor">
            <i class="fas fa-user-circle"></i>
            {{ entry.actor.firstName || entry.actor.email }} · {{ entry.actor.role }}
          </p>
          <p v-else class="actor">{{ store.isArabic ? 'نظام' : 'System' }}</p>
          <ul v-if="entry.changes.length" class="changes">
            <li v-for="change in entry.changes" :key="change.field">
              <span class="field">{{ fieldLabel(change.field) }}</span>
              <template v-if="change.before !== undefined || change.after !== undefined">
                <span class="old">{{ display(change.before) }}</span>
                <span aria-hidden="true">{{ store.isArabic ? '←' : '→' }}</span>
                <span class="new">{{ display(change.after) }}</span>
              </template>
              <span v-else class="muted">{{ store.isArabic ? 'تم التعديل' : 'changed' }}</span>
            </li>
          </ul>
          <p v-if="metadataText(entry)" class="meta">{{ metadataText(entry) }}</p>
        </div>
      </li>
    </ol>

    <div v-if="hasMore" class="more">
      <button class="btn" type="button" :disabled="loading" @click="loadMore">
        {{ loading ? (store.isArabic ? 'جارٍ التحميل…' : 'Loading…') : (store.isArabic ? 'تحميل المزيد' : 'Load more') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { apiGet, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { ActivityEntry } from '@/types'

const props = withDefaults(defineProps<{
  entityType?: string
  entityId?: string
  limit?: number
  showFilters?: boolean
}>(), { entityType: '', entityId: '', limit: 20, showFilters: true })

const store = useStore()
const entries = ref<ActivityEntry[]>([])
const nextCursor = ref<string | null>(null)
const page = ref(1)
const total = ref<number | null>(null)
const loading = ref(false)
const error = ref('')
const filters = reactive({ entityType: '', action: '', userId: '', from: '', to: '' })

const ALL_ENTITY_TYPES = [
  'Property', 'Owner', 'Lead', 'Deal', 'Payment', 'Expense',
  'Appointment', 'MaintenanceRequest', 'Document', 'Commission'
]
const FINANCE_ENTITY_TYPES = ['Payment', 'Expense', 'Commission']
const entityTypes = computed(() => store.user?.role === 'AGENT'
  ? ALL_ENTITY_TYPES.filter((type) => !FINANCE_ENTITY_TYPES.includes(type))
  : ALL_ENTITY_TYPES)

const isEntityMode = computed(() => Boolean(props.entityType && props.entityId))
const hasMore = computed(() => Boolean(nextCursor.value) || (total.value !== null && entries.value.length < total.value))

const ENTITY_LABELS: Record<string, string> = {
  Property: 'عقار', Owner: 'مالك', Lead: 'عميل محتمل', Deal: 'صفقة',
  Payment: 'دفعة', Expense: 'مصروف', Appointment: 'موعد',
  MaintenanceRequest: 'طلب صيانة', Document: 'وثيقة', Commission: 'عمولة'
}

const ACTION_LABELS: Record<string, [string, string]> = {
  PROPERTY_CREATED: ['Property created', 'تم إنشاء العقار'],
  PROPERTY_UPDATED: ['Property updated', 'تم تعديل العقار'],
  PROPERTY_ARCHIVED: ['Property archived', 'تم أرشفة العقار'],
  PROPERTY_RESTORED: ['Property restored', 'تمت استعادة العقار'],
  PROPERTY_STATUS_CHANGED: ['Property status changed', 'تغيرت حالة العقار'],
  PROPERTY_PRICE_CHANGED: ['Property price changed', 'تغير سعر العقار'],
  PROPERTY_ASSIGNED: ['Property assigned', 'تم إسناد العقار'],
  PROPERTY_IMAGES_UPLOADED: ['Property images uploaded', 'تم رفع صور العقار'],
  PROPERTY_SHARE_SUMMARY_GENERATED: ['Client share summary generated', 'تم إنشاء ملخص المشاركة للعميل'],
  OWNER_CREATED: ['Owner created', 'تم إنشاء المالك'],
  OWNER_UPDATED: ['Owner updated', 'تم تعديل المالك'],
  OWNER_ARCHIVED: ['Owner archived', 'تم أرشفة المالك'],
  OWNER_RESTORED: ['Owner restored', 'تمت استعادة المالك'],
  LEAD_CREATED: ['Lead created', 'تم إنشاء العميل المحتمل'],
  LEAD_UPDATED: ['Lead updated', 'تم تعديل العميل المحتمل'],
  LEAD_ARCHIVED: ['Lead archived', 'تم أرشفة العميل المحتمل'],
  APPOINTMENT_CREATED: ['Appointment created', 'تم إنشاء الموعد'],
  APPOINTMENT_UPDATED: ['Appointment updated', 'تم تعديل الموعد'],
  APPOINTMENT_DELETED: ['Appointment deleted', 'تم حذف الموعد'],
  DEAL_CREATED: ['Deal created', 'تم إنشاء الصفقة'],
  DEAL_UPDATED: ['Deal updated', 'تم تعديل الصفقة'],
  DEAL_STATUS_CHANGED: ['Deal status changed', 'تغيرت حالة الصفقة'],
  DEAL_ARCHIVED: ['Deal archived', 'تم أرشفة الصفقة'],
  DEAL_LINKED: ['Deal linked to property', 'تم ربط الصفقة بالعقار'],
  PAYMENT_RECORDED: ['Payment recorded', 'تم تسجيل الدفعة'],
  PAYMENT_UPDATED: ['Payment updated', 'تم تعديل الدفعة'],
  EXPENSE_RECORDED: ['Expense recorded', 'تم تسجيل المصروف'],
  EXPENSE_UPDATED: ['Expense updated', 'تم تعديل المصروف'],
  EXPENSE_ARCHIVED: ['Expense archived', 'تم أرشفة المصروف'],
  COMMISSION_CONFIGURED: ['Commission configured', 'تم تحديد العمولة'],
  COMMISSION_UPDATED: ['Commission updated', 'تم تعديل العمولة'],
  COMMISSION_ARCHIVED: ['Commission archived', 'تم أرشفة العمولة'],
  MAINTENANCE_CREATED: ['Maintenance request created', 'تم إنشاء طلب الصيانة'],
  MAINTENANCE_UPDATED: ['Maintenance request updated', 'تم تعديل طلب الصيانة'],
  MAINTENANCE_STATUS_CHANGED: ['Maintenance status changed', 'تغيرت حالة الصيانة'],
  MAINTENANCE_ARCHIVED: ['Maintenance request archived', 'تم أرشفة طلب الصيانة'],
  DOCUMENT_UPLOADED: ['Document uploaded', 'تم رفع الوثيقة'],
  DOCUMENT_UPDATED: ['Document updated', 'تم تعديل الوثيقة'],
  DOCUMENT_STATUS_CHANGED: ['Document status changed', 'تغيرت حالة الوثيقة'],
  DOCUMENT_ARCHIVED: ['Document archived', 'تم أرشفة الوثيقة']
}

const WORD_LABELS: Record<string, string> = {
  PROPERTY: 'عقار', BULK: 'جماعي', STATUS: 'حالة', CHANGED: 'تغيير', IMAGE: 'صورة', IMAGES: 'صور',
  PRIMARY: 'رئيسية', SET: 'تعيين', REORDERED: 'إعادة ترتيب', ARCHIVED: 'أرشفة', RESTORED: 'استعادة',
  CREATED: 'إنشاء', UPDATED: 'تعديل', ASSIGNED: 'إسناد', DEAL: 'صفقة', LINKED: 'ربط',
  PAYMENT: 'دفعة', RECORDED: 'تسجيل', EXPENSE: 'مصروف', COMMISSION: 'عمولة', CONFIGURED: 'تحديد',
  MAINTENANCE: 'صيانة', REQUEST: 'طلب', DOCUMENT: 'وثيقة', UPLOADED: 'رفع',
  SHARE: 'مشاركة', SUMMARY: 'ملخص', GENERATED: 'إنشاء',
  PRICE: 'سعر', CURRENCY: 'عملة', OLD: 'قديم', NEW: 'جديد',
  OWNER: 'مالك', LEAD: 'عميل محتمل', APPOINTMENT: 'موعد', DELETED: 'حذف'
}

const FIELD_LABELS: Record<string, [string, string]> = {
  price: ['Price', 'السعر'],
  currency: ['Currency', 'العملة'],
  before: ['Before', 'قبل'],
  after: ['After', 'بعد']
}

function readable(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action]
  if (known) return store.isArabic ? known[1] : known[0]
  if (!store.isArabic) return readable(action)
  const arabicWords = action.split('_').map((word) => WORD_LABELS[word] || word.toLowerCase())
  return `${arabicWords.join(' ')} (${readable(action)})`
}

function entityLabel(type: string): string {
  return store.isArabic ? ENTITY_LABELS[type] || type : readable(type)
}

function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field]
  if (known) return store.isArabic ? known[1] : known[0]
  return store.isArabic ? (WORD_LABELS[field.toUpperCase()] || field) : readable(field)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar' : 'en')
}

function display(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return '∅'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function metadataText(entry: ActivityEntry): string {
  const pairs = Object.entries(entry.metadata || {})
    .filter(([key]) => !/pass(word|phrase)|secret|token|credential|key|storage|path|session/i.test(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${display(value)}`)
  return pairs.join(' · ')
}

function buildParams(): Record<string, string | number> {
  const params: Record<string, string | number> = { limit: props.limit }
  if (!isEntityMode.value && filters.entityType) params.entityType = filters.entityType
  if (filters.action) params.action = filters.action
  if (filters.userId) params.userId = filters.userId
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return params
}

async function load(reset: boolean): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    if (reset) {
      entries.value = []
      nextCursor.value = null
      total.value = null
      page.value = 1
    }
    const params = buildParams()
    if (!isEntityMode.value && nextCursor.value) params.cursor = nextCursor.value
    if (isEntityMode.value && page.value > 1) params.page = page.value

    const url = isEntityMode.value
      ? `/activity/${encodeURIComponent(props.entityType)}/${encodeURIComponent(props.entityId)}`
      : '/activity'
    const response = await apiGet<ActivityEntry[]>(url, { params })
    entries.value = reset ? (response.data || []) : [...entries.value, ...(response.data || [])]
    const envelope = response as typeof response & { nextCursor?: string | null }
    nextCursor.value = envelope.nextCursor ?? null
    if (response.pagination) total.value = response.pagination.total
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}

function reload(): void { void load(true) }
function loadMore(): void {
  if (isEntityMode.value) page.value += 1
  void load(false)
}
function clearFilters(): void {
  Object.assign(filters, { entityType: '', action: '', userId: '', from: '', to: '' })
  reload()
}

onMounted(() => { void load(true) })
watch(() => [props.entityType, props.entityId], () => { void load(true) })
</script>

<style scoped>
.activity-panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.1rem 1.3rem; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.8rem; }
h2 { font-size: 1.05rem; margin: 0; }
.count { font-size: 0.75rem; color: #4b5563; background: #f3f4f6; border-radius: 999px; padding: 0.15rem 0.55rem; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.6rem; align-items: end; margin-bottom: 1rem; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.74rem; color: #4b5563; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.45rem 0.55rem; font-size: 0.82rem; min-width: 0; direction: ltr; }
.fixed-entity { padding: 0.45rem 0; font-size: 0.85rem; font-weight: 600; }
.btn { border: 0; border-radius: 8px; padding: 0.5rem 0.8rem; font-size: 0.8rem; cursor: pointer; background: #4f46e5; color: #fff; }
.btn.quiet { background: #f3f4f6; color: #374151; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.state { text-align: center; padding: 1.2rem; color: #6b7280; font-size: 0.86rem; background: #f9fafb; border-radius: 8px; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.84rem; }
.timeline { list-style: none; margin: 0; padding: 0; }
.timeline li { position: relative; display: flex; gap: 0.8rem; padding: 0 0 1rem 0; border-inline-start: 2px solid #e0e7ff; margin-inline-start: 0.6rem; padding-inline-start: 1rem; }
.timeline li:last-child { border-inline-start-color: transparent; }
.marker { position: absolute; inset-inline-start: -0.72rem; top: 0.1rem; width: 1.35rem; height: 1.35rem; border-radius: 50%; background: #eef2ff; color: #4338ca; display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem; }
.event-body { min-width: 0; flex: 1; }
.event-head { display: flex; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; font-size: 0.88rem; }
.event-head time { color: #6b7280; font-size: 0.76rem; }
.event-entity { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; font-size: 0.84rem; flex-wrap: wrap; }
.event-entity a { color: #4f46e5; text-decoration: none; }
.tag { font-size: 0.68rem; color: #3730a3; background: #e0e7ff; border-radius: 999px; padding: 0.15rem 0.55rem; }
.actor { margin: 0.3rem 0 0; color: #6b7280; font-size: 0.78rem; }
.changes { list-style: none; padding: 0; margin: 0.4rem 0 0; font-size: 0.78rem; }
.changes li { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; padding: 0.1rem 0; border: 0; margin: 0; }
.field { color: #374151; font-weight: 600; }
.old { color: #991b1b; text-decoration: line-through; }
.new { color: #166534; }
.muted { color: #6b7280; }
.meta { margin: 0.35rem 0 0; color: #6b7280; font-size: 0.75rem; overflow-wrap: anywhere; }
.more { display: flex; justify-content: center; margin-top: 0.4rem; }
@media (max-width: 640px) { .activity-panel { padding: 0.9rem; } }
</style>
