<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? config.titleAr : config.title }}</h1>
        <p class="muted">{{ rows.length }} {{ store.isArabic ? 'سجل' : 'records' }}</p>
      </div>
      <div class="head-actions">
        <div v-if="isAppointments" class="view-toggle" role="group" :aria-label="store.isArabic ? ' طريقة العرض' : 'View mode'">
          <button type="button" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">
            {{ store.isArabic ? 'قائمة' : 'List' }}
          </button>
          <button type="button" :class="{ active: viewMode === 'agenda' }" @click="viewMode = 'agenda'">
            {{ store.isArabic ? 'جدول' : 'Agenda' }}
          </button>
        </div>
        <label v-if="isDeals" class="stage-filter">
          <span>{{ store.isArabic ? 'المرحلة' : 'Stage' }}</span>
          <select v-model="statusFilter">
            <option value="">{{ store.isArabic ? 'كل المراحل' : 'All stages' }}</option>
            <option v-for="status in dealStatus" :key="status" :value="status">{{ readableStatus(status) }}</option>
          </select>
        </label>
        <button class="btn btn-quiet" type="button" :disabled="exporting" @click="onExport">
          <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
        </button>
        <button class="btn btn-primary" type="button" @click="openCreate">
          <i class="fas fa-plus"></i> {{ store.isArabic ? 'إضافة' : 'Add' }}
        </button>
      </div>
    </div>

    <div v-if="conflictWarning" class="warning" role="alert">
      <strong>{{ conflictWarning.message }}</strong>
      <ul v-if="conflictWarning.conflicts?.length">
        <li v-for="conflict in conflictWarning.conflicts" :key="conflict.id">{{ conflictLabel(conflict) }}</li>
      </ul>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!rows.length" class="state">
      {{ store.isArabic ? 'لا توجد سجلات بعد.' : 'No records yet.' }}
    </div>
    <template v-else>
      <div v-if="isAppointments && viewMode === 'agenda'" class="agenda">
        <section v-for="group in groupedRows" :key="group.key" class="agenda-day">
          <h2>{{ group.label }}</h2>
          <article v-for="row in group.rows" :key="String(row.id)" class="agenda-item">
            <div class="agenda-time">{{ timeRange(row) }}</div>
            <div class="agenda-main">
              <strong>{{ row.title || row.type || '—' }}</strong>
              <span class="agenda-meta">
                {{ readableStatus(String(row.type)) }} · {{ store.isArabic ? 'العقار' : 'Property' }}: {{ row.propertyId || '—' }}
              </span>
              <span v-if="row.notes" class="outcome">{{ truncate(String(row.notes)) }}</span>
            </div>
            <div class="agenda-side">
              <span class="status-pill" :class="statusClass(String(row.status))">{{ readableStatus(String(row.status)) }}</span>
              <select :value="row.status" :disabled="statusSaving === String(row.id)" @change="onQuickStatus(row, $event)">
                <option v-for="status in appointmentStatus" :key="status" :value="status">{{ readableStatus(status) }}</option>
              </select>
              <button type="button" class="link" @click="openEdit(row)">{{ store.isArabic ? 'تعديل' : 'Edit' }}</button>
              <button v-if="canDelete" type="button" class="link danger" @click="onDelete(row)">
                {{ store.isArabic ? 'حذف' : 'Delete' }}
              </button>
            </div>
          </article>
        </section>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="column in config.columns" :key="column.key">{{ column.label }}</th>
              <th class="actions-col">{{ store.isArabic ? 'إجراءات' : 'Actions' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)">
              <td v-for="column in config.columns" :key="column.key" :data-label="column.label">
                <template v-if="(isAppointments || isDeals) && column.key === 'status'">
                  <span class="status-pill" :class="statusClass(String(row.status))">{{ readableStatus(String(row.status)) }}</span>
                </template>
                <template v-else-if="isDeals && column.key === 'referenceNumber'">
                  <router-link class="record-link" :to="`/deals/${row.id}`">
                    {{ display(row[column.key], column, row) }}
                  </router-link>
                </template>
                <template v-else>{{ display(row[column.key], column, row) }}</template>
              </td>
              <td class="actions-col">
                <select
                  v-if="isAppointments"
                  class="quick-status"
                  :value="row.status"
                  :disabled="statusSaving === String(row.id)"
                  @change="onQuickStatus(row, $event)"
                >
                  <option v-for="status in appointmentStatus" :key="status" :value="status">{{ readableStatus(status) }}</option>
                </select>
                <router-link v-if="isDeals" class="link" :to="`/deals/${row.id}`">
                  {{ store.isArabic ? 'عرض' : 'View' }}
                </router-link>
                <button v-if="props.resource === 'leads'" type="button" class="link" @click="openMatches(row)">
                  {{ store.isArabic ? '???????' : 'Matches' }}
                </button>
                <button v-if="props.resource === 'leads'" type="button" class="link" @click="openActivity(row)">
                  {{ store.isArabic ? '??????' : 'Activity' }}
                </button>
                <button type="button" class="link" @click="openEdit(row)">{{ store.isArabic ? 'تعديل' : 'Edit' }}</button>
                <button v-if="canDelete" type="button" class="link danger" @click="onDelete(row)">
                  {{ store.isArabic ? 'حذف' : 'Delete' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="formOpen" class="overlay" @click.self="closeForm">
      <form class="modal" @submit.prevent="onSave">
        <div class="modal-head">
          <h2>{{ editingId ? (store.isArabic ? 'تعديل' : 'Edit') : (store.isArabic ? 'إضافة' : 'Add') }}</h2>
          <button type="button" aria-label="Close" @click="closeForm">×</button>
        </div>
        <div class="modal-body">
          <label v-for="field in visibleFields" :key="field.key" :class="{ checkbox: field.type === 'checkbox' }">
            <template v-if="field.type !== 'checkbox'">
              <span>{{ field.label }}{{ field.required ? ' *' : '' }}</span>
              <select v-if="field.type === 'select'" v-model="form[field.key]" :required="field.required">
                <option value="">—</option>
                <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
              </select>
              <textarea v-else-if="field.type === 'textarea'" v-model="form[field.key]" rows="3" :required="field.required"></textarea>
              <input
                v-else
                v-model="form[field.key]"
                :type="field.type"
                :required="field.required"
                :step="field.type === 'number' ? '0.01' : undefined"
              />
            </template>
            <template v-else>
              <input v-model="form[field.key]" type="checkbox" />
              <span>{{ field.label }}</span>
            </template>
          </label>
          <div v-if="formError" class="error" role="alert">{{ formError }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}</button>
          <button class="btn btn-quiet" type="button" @click="closeForm">{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</button>
        </div>
      </form>
    </div>

    <div v-if="activityOpen && activityId" class="overlay" @click.self="activityOpen = false">
      <section class="modal">
        <div class="modal-head">
          <h2>{{ store.isArabic ? 'سجل نشاط العميل المحتمل' : 'Lead activity' }}</h2>
          <button type="button" aria-label="Close" @click="activityOpen = false">×</button>
        </div>
        <div class="modal-body">
          <ActivityTimeline
            :key="activityId"
            class="activity-full"
            entity-type="Lead"
            :entity-id="activityId"
            :limit="10"
            :show-filters="false"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import {
  appointmentStatus,
  dealStatus,
  dealTransitions,
  initialDealStatuses,
  resources,
  type FieldConfig,
  type ResourceConfig
} from '@/config/resources'
import { downloadCsv, type CsvRow } from '@/utils/csv'
import { useStore } from '@/stores'
import type { ApiWarning, AppointmentConflictInfo } from '@/types'

const props = defineProps<{ resource: string }>()
const router = useRouter()
const store = useStore()
const config = computed<ResourceConfig>(() => resources[props.resource] || resources.leads)
const isAppointments = computed(() => props.resource === 'appointments')
const isDeals = computed(() => props.resource === 'deals')

type Row = Record<string, unknown> & { id: string }
const rows = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const activityOpen = ref(false)
const activityId = ref('')
const matchesOpen = ref(false)
const matchesLoading = ref(false)
const matchesLead = ref<Row | null>(null)
const matches = ref<Array<{ score: number; reasons: string[]; property: Record<string, unknown> & { id: string } }>>([])
const form = reactive<Record<string, unknown>>({})
const viewMode = ref<'list' | 'agenda'>('list')
const conflictWarning = ref<ApiWarning | null>(null)
const statusSaving = ref<string | null>(null)
const exporting = ref(false)
const statusFilter = ref('')

const visibleFields = computed<FieldConfig[]>(() =>
  config.value.fields
    .map((field) => {
      if (!isDeals.value || field.key !== 'status') return field
      const current = String(form.status || '')
      const options = editingId.value
        ? Array.from(new Set([current, ...(dealTransitions[current] || [])].filter(Boolean)))
        : initialDealStatuses
      return { ...field, options }
    })
    .filter((field) => !field.createOnly || !editingId.value)
)

const groupedRows = computed(() => {
  const locale = store.isArabic ? 'ar-SA' : 'en-US'
  const groups = new Map<string, { key: string; label: string; rows: Row[] }>()
  const sorted = [...rows.value].sort((a, b) =>
    new Date(String(a.startsAt)).getTime() - new Date(String(b.startsAt)).getTime()
  )
  for (const row of sorted) {
    const date = new Date(String(row.startsAt))
    const valid = !Number.isNaN(date.getTime())
    const key = valid ? date.toDateString() : 'unknown'
    const group = groups.get(key) || {
      key,
      label: valid
        ? new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date)
        : '—',
      rows: []
    }
    group.rows.push(row)
    groups.set(key, group)
  }
  return Array.from(groups.values())
})

const canDelete = computed(() => {
  if (!config.value.deletable || !store.user) return false
  const allowed = config.value.deletableRoles
  return !allowed || allowed.includes(store.user.role)
})

watch(config, () => { void load() })
watch(statusFilter, () => { void load() })

onMounted(() => { void load(); applyQueryPrefill() })

async function load(): Promise<void> {
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 100 }
    if (isDeals.value && statusFilter.value) params.status = statusFilter.value
    const response = await apiGet<Row[] | { data: Row[] }>(config.value.endpoint, { params })
    const payload = response.data
    rows.value = Array.isArray(payload) ? payload : (payload?.data ?? [])
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    loading.value = false
  }
}

function initialForm(): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  config.value.fields.forEach((field) => {
    values[field.key] = field.default ?? (field.type === 'checkbox' ? false : '')
  })
  return values
}

function openCreate(prefill: Record<string, unknown> = {}): void {
  editingId.value = null
  Object.assign(form, initialForm(), prefill)
  if (props.resource === 'users' && store.user) form.organizationId = store.user.organizationId
  formError.value = ''
  conflictWarning.value = null
  formOpen.value = true
}

function applyQueryPrefill(): void {
  const q = router.currentRoute.value.query
  if (props.resource === 'deals') {
    const prefill: Record<string, unknown> = {}
    if (typeof q.propertyId === 'string') prefill.propertyId = q.propertyId
    if (typeof q.leadId === 'string') prefill.leadId = q.leadId
    if (typeof q.userId === 'string') prefill.userId = q.userId
    if (typeof q.amount === 'string') prefill.amount = q.amount
    if (Object.keys(prefill).length) openCreate(prefill)
  }
  if (props.resource === 'appointments') {
    const prefill: Record<string, unknown> = {}
    if (typeof q.propertyId === 'string') prefill.propertyId = q.propertyId
    if (typeof q.leadId === 'string') prefill.leadId = q.leadId
    if (Object.keys(prefill).length) openCreate(prefill)
  }
}

function openEdit(row: Row): void {
  editingId.value = String(row.id)
  Object.assign(form, initialForm())
  config.value.fields.forEach((field) => {
    if (field.createOnly) return
    const value = row[field.key]
    form[field.key] = field.type === 'datetime-local' && typeof value === 'string'
      ? value.slice(0, 16)
      : (value ?? field.default ?? '')
  })
  formError.value = ''
  conflictWarning.value = null
  formOpen.value = true
}

function closeForm(): void {
  formOpen.value = false
  editingId.value = null
}

function openActivity(row: Row): void {
  activityId.value = String(row.id)
  activityOpen.value = true
}

async function openMatches(row: Row): Promise<void> {
  matchesLead.value = row
  matchesOpen.value = true
  matchesLoading.value = true
  matches.value = []
  try {
    const response = await apiGet<{ matches?: Array<{ score: number; reasons: string[]; property: Record<string, unknown> & { id: string } }> }>(`/leads/${row.id}/matches`)
    matches.value = response.data?.matches || []
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    matchesLoading.value = false
  }
}

function closeMatches(): void {
  matchesOpen.value = false
  matchesLead.value = null
  matches.value = []
}

function prefillDeal(propertyId: string): void {
  const lead = matchesLead.value
  const query: Record<string, string> = { propertyId }
  if (lead?.id) query.leadId = String(lead.id)
  if (lead?.assignedToId) query.userId = String(lead.assignedToId)
  if (typeof lead?.budgetMax === 'number' || typeof lead?.budgetMax === 'string') query.amount = String(lead.budgetMax)
  else if (typeof lead?.budgetMin === 'number' || typeof lead?.budgetMin === 'string') query.amount = String(lead.budgetMin)
  closeMatches()
  void router.push({ path: '/deals', query })
}

function prefillAppointment(propertyId: string): void {
  const lead = matchesLead.value
  const query: Record<string, string> = { propertyId }
  if (lead?.id) query.leadId = String(lead.id)
  closeMatches()
  void router.push({ path: '/appointments', query })
}

function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  config.value.fields.forEach((field) => {
    if (field.createOnly && editingId.value) return
    const value = form[field.key]
    if (field.type === 'number') {
      if (value !== '' && value != null) payload[field.key] = Number(value)
      return
    }
    if (field.type === 'checkbox') {
      payload[field.key] = Boolean(value)
      return
    }
    if (value !== '' && value != null) payload[field.key] = value
  })
  if (props.resource === 'users' && store.user && !editingId.value) {
    payload.organizationId = store.user.organizationId
  }
  return payload
}

async function onSave(): Promise<void> {
  formError.value = ''
  if (isAppointments.value && form.startsAt && form.endsAt) {
    const start = new Date(String(form.startsAt))
    const end = new Date(String(form.endsAt))
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      formError.value = store.isArabic
        ? 'يجب أن يكون وقت الانتهاء بعد وقت البدء.'
        : 'End time must be after start time.'
      return
    }
  }
  saving.value = true
  try {
    const payload = buildPayload()
    const response = editingId.value
      ? await apiPatch<{ id: string }>(`${config.value.endpoint}/${editingId.value}`, payload)
      : await apiPost<{ id: string }>(config.value.endpoint, payload)
    conflictWarning.value = response.warnings?.find((warning) => warning.code === 'APPOINTMENT_CONFLICT') || null
    closeForm()
    await load()
  } catch (e) {
    formError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function onDelete(row: Row): Promise<void> {
  if (!window.confirm(store.isArabic ? 'تأكيد الحذف؟' : 'Delete this record?')) return
  try {
    await apiDelete(`${config.value.endpoint}/${row.id}`)
    await load()
  } catch (e) {
    store.error = errorMessage(e)
  }
}

function readableStatus(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function statusClass(value: string): string {
  return `status-${value.toLowerCase().replaceAll('_', '-')}`
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(store.isArabic ? 'ar-SA' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function timeRange(row: Row): string {
  const start = formatDateTime(String(row.startsAt))
  return row.endsAt ? `${start} → ${formatDateTime(String(row.endsAt))}` : start
}

function conflictLabel(conflict: AppointmentConflictInfo): string {
  const reasons = conflict.reasons
    .map((reason) => reason === 'user'
      ? (store.isArabic ? 'نفس المستخدم' : 'same user')
      : (store.isArabic ? 'نفس العقار' : 'same property'))
    .join(' + ')
  return `${conflict.title || (store.isArabic ? 'موعد' : 'Appointment')} · ${formatDateTime(conflict.startsAt)} · ${reasons}`
}

async function onQuickStatus(row: Row, event: Event): Promise<void> {
  const status = (event.target as HTMLSelectElement).value
  statusSaving.value = String(row.id)
  try {
    const response = await apiPatch<{ status: string }>(`${config.value.endpoint}/${row.id}`, { status })
    row.status = response.data?.status || status
    conflictWarning.value = response.warnings?.find((warning) => warning.code === 'APPOINTMENT_CONFLICT') || null
  } catch (e) {
    store.error = errorMessage(e)
    await load()
  } finally {
    statusSaving.value = null
  }
}

function csvPlain(value: unknown): string | number {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.title || record.referenceNumber || record.email || JSON.stringify(record))
  }
  return value as string | number
}

function onExport(): void {
  if (exporting.value) return
  exporting.value = true
  try {
    const columns = config.value.columns.map((column) => ({ key: column.key, label: column.label }))
    const exportRows: CsvRow[] = rows.value.map((row) => {
      const result: CsvRow = {}
      for (const column of config.value.columns) {
        const value = row[column.key]
        if (column.money) {
          const currency = typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim().toUpperCase() : 'UNSPECIFIED'
          result[column.key] = value === null || value === undefined || value === ''
            ? ''
            : `${Number(value).toFixed(2)} ${currency}`
        } else if (column.date) {
          result[column.key] = value == null || value === '' ? '' : formatDateTime(String(value))
        } else if (isAppointments.value && column.key === 'notes') {
          result[column.key] = truncate(csvPlain(value) ? String(csvPlain(value)) : '')
        } else {
          result[column.key] = csvPlain(value)
        }
      }
      return result
    })
    downloadCsv(`${props.resource}-export`, columns, exportRows)
  } finally {
    exporting.value = false
  }
}

function display(value: unknown, column: ResourceConfig['columns'][number], row: Row): string {
  if (value == null || value === '') return '—'
  if (isAppointments.value && column.key === 'notes') return truncate(String(value))
  if (isAppointments.value && column.date) return formatDateTime(String(value))
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (column.date) {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
  }
  if (column.money) {
    const currency = typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim().toUpperCase() : ''
    if (!currency) return `${Number(value || 0).toLocaleString(store.isArabic ? 'ar-SA' : 'en-US')} UNSPECIFIED`
    try {
      return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
        style: 'currency', currency, maximumFractionDigits: 2
      }).format(Number(value))
    } catch {
      return `${value} ${currency}`
    }
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.title || record.referenceNumber || record.email || JSON.stringify(record))
  }
  return String(value)
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0; font-size: 1.15rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 8px; padding: 0.6rem 1rem; border: 0; font-size: 0.86rem; cursor: pointer; text-decoration: none; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.head-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.view-toggle { display: inline-flex; border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden; }
.view-toggle button { border: 0; background: #fff; color: #374151; padding: 0.55rem 0.8rem; font-size: 0.82rem; cursor: pointer; }
.view-toggle button.active { background: #e0e7ff; color: #3730a3; font-weight: 600; }
.warning { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 10px; padding: 0.75rem 0.9rem; font-size: 0.84rem; }
.warning ul { margin: 0.4rem 0 0; padding-inline-start: 1.2rem; }
.status-pill { display: inline-block; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.72rem; background: #e0e7ff; color: #3730a3; }
.status-draft { background: #f3f4f6; color: #4b5563; }
.status-pending { background: #fef3c7; color: #92400e; }
.status-active { background: #e0e7ff; color: #3730a3; }
.status-completed { background: #dcfce7; color: #166534; }
.status-cancelled, .status-no-show { background: #fee2e2; color: #991b1b; }
.stage-filter { display: inline-flex; flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #374151; }
.stage-filter select { padding: 0.4rem 0.5rem; font-size: 0.82rem; }
.record-link { color: #4f46e5; font-weight: 600; text-decoration: none; }
.record-link:hover { text-decoration: underline; }
.quick-status, .agenda-side select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.3rem 0.4rem; font-size: 0.78rem; margin-inline-end: 0.35rem; }
.agenda { display: flex; flex-direction: column; gap: 1rem; }
.agenda-day { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; }
.agenda-day h2 { font-size: 0.95rem; margin: 0 0 0.7rem; color: #374151; }
.agenda-item { display: grid; grid-template-columns: minmax(150px, 190px) 1fr auto; gap: 0.8rem; align-items: start; padding: 0.7rem 0; border-top: 1px solid #f3f4f6; }
.agenda-time { font-size: 0.82rem; color: #4f46e5; font-weight: 600; }
.agenda-main { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.86rem; }
.agenda-main strong { color: #111827; }
.agenda-meta { color: #6b7280; font-size: 0.78rem; }
.outcome { color: #4b5563; font-size: 0.78rem; }
.agenda-side { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; }
.state { background: #fff; border-radius: 12px; padding: 3rem; text-align: center; color: #6b7280; }
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
th, td { text-align: start; padding: 0.7rem 0.9rem; border-bottom: 1px solid #f3f4f6; white-space: nowrap; }
th { background: #f9fafb; font-size: 0.74rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
.actions-col { text-align: end; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.82rem; margin-inline-start: 0.5rem; }
.link.danger { color: #dc2626; }
.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: grid; place-items: center; padding: 1rem; z-index: 20; }
.modal { background: #fff; border-radius: 14px; width: min(100%, 560px); max-height: 90vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.2rem; border-bottom: 1px solid #eef2f7; }
.modal-head button { background: none; border: 0; font-size: 1.4rem; cursor: pointer; }
.modal-body { padding: 1.2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.8rem; }
.activity-full { grid-column: 1 / -1; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
label.checkbox { flex-direction: row; align-items: center; gap: 0.5rem; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.88rem; font-family: inherit; }
.error { grid-column: 1 / -1; background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.84rem; }
.modal-actions { display: flex; gap: 0.6rem; padding: 1rem 1.2rem; border-top: 1px solid #eef2f7; }
@media (max-width: 640px) {
  th, td { padding: 0.55rem 0.6rem; }
  .agenda-item { grid-template-columns: 1fr; }
  .agenda-side { justify-content: flex-start; }
}
</style>
