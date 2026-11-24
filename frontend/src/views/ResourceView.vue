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
        <label v-if="isLeads" class="stage-filter">
          <span>{{ store.isArabic ? 'المتابعة' : 'Follow-up' }}</span>
          <select v-model="followUpFilter">
            <option value="">{{ store.isArabic ? 'الكل' : 'All' }}</option>
            <option value="overdue">{{ store.isArabic ? 'متأخرة' : 'Overdue' }}</option>
            <option value="today">{{ store.isArabic ? 'اليوم' : 'Today' }}</option>
            <option value="upcoming">{{ store.isArabic ? 'قادمة' : 'Upcoming' }}</option>
          </select>
        </label>
        <button class="btn btn-quiet" type="button" :disabled="exporting" @click="onExport">
          <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
        </button>
        <button v-if="isLeads" class="btn btn-quiet" type="button" @click="openImport">
          <i class="fas fa-file-arrow-up"></i> {{ store.isArabic ? 'استيراد CSV' : 'Import CSV' }}
        </button>
        <button class="btn btn-primary" type="button" @click="openCreate">
          <i class="fas fa-plus"></i> {{ store.isArabic ? 'إضافة' : 'Add' }}
        </button>
      </div>
    </div>

    <div v-if="isLeads" class="lead-filters">
      <label>
        <span>{{ store.isArabic ? 'المصدر' : 'Source' }}</span>
        <input v-model="sourceFilter" type="text" maxlength="100" :placeholder="store.isArabic ? 'كل المصادر' : 'All sources'" list="lead-sources" />
        <datalist id="lead-sources">
          <option v-for="source in leadSources" :key="source" :value="source"></option>
        </datalist>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الأولوية' : 'Priority' }}</span>
        <select v-model="priorityFilter">
          <option value="">{{ store.isArabic ? 'كل المستويات' : 'All tiers' }}</option>
          <option v-for="tier in priorityTiers" :key="tier" :value="tier">{{ priorityLabel(tier) }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'ميزانية من' : 'Budget min' }}</span>
        <input v-model="budgetMinFilter" type="number" min="0" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'ميزانية إلى' : 'Budget max' }}</span>
        <input v-model="budgetMaxFilter" type="number" min="0" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الترتيب' : 'Sort' }}</span>
        <select v-model="sortFilter">
          <option value="priority_desc">{{ store.isArabic ? 'الأولوية: الأعلى أولًا' : 'Priority: high first' }}</option>
          <option value="priority_asc">{{ store.isArabic ? 'الأولوية: الأقل أولًا' : 'Priority: low first' }}</option>
          <option value="budget_desc">{{ store.isArabic ? 'الميزانية: الأعلى أولًا' : 'Budget: high first' }}</option>
          <option value="newest">{{ store.isArabic ? 'الأحدث' : 'Newest' }}</option>
          <option value="oldest">{{ store.isArabic ? 'الأقدم' : 'Oldest' }}</option>
        </select>
      </label>
      <button type="button" class="btn btn-quiet" @click="clearLeadFilters">
        {{ store.isArabic ? 'مسح الفلاتر' : 'Clear filters' }}
      </button>
    </div>

    <div v-if="isPayments" class="aging-filters">
      <label>
        <span>{{ store.isArabic ? 'الفئة العمرية' : 'Aging bucket' }}</span>
        <select v-model="agingFilter">
          <option value="">{{ store.isArabic ? 'كل الفئات' : 'All buckets' }}</option>
          <option v-for="bucket in paymentAgingBuckets" :key="bucket" :value="bucket">{{ agingLabel(bucket, store.isArabic) }}</option>
        </select>
      </label>
    </div>

    <div v-if="isUsers && store.canManage" class="user-filters">
      <label class="checkbox-line">
        <input v-model="includeInactive" type="checkbox" />
        <span>{{ store.isArabic ? 'عرض الحسابات المعطّلة' : 'Show deactivated accounts' }}</span>
      </label>
    </div>

    <div v-if="conflictWarning" class="warning" role="alert">
      <strong>{{ conflictWarning.message }}</strong>
      <ul v-if="conflictWarning.conflicts?.length">
        <li v-for="conflict in conflictWarning.conflicts" :key="conflict.id">{{ conflictLabel(conflict) }}</li>
      </ul>
    </div>
    <div v-if="importMessage && !importOpen" class="import-summary" role="status">{{ importMessage }}</div>

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
              <button v-if="isAppointments" type="button" class="link whatsapp-link" :title="store.isArabic ? 'إرسال تذكير واتساب' : 'Send WhatsApp reminder'" @click="whatsappForAppointment(row)">
                <i class="fab fa-whatsapp"></i> {{ store.isArabic ? 'واتساب' : 'WhatsApp' }}
              </button>
              <button type="button" class="link whatsapp-link" :title="store.isArabic ? 'إرسال تذكير واتساب' : 'Send WhatsApp reminder'" @click="whatsappForAppointment(row)">
                <i class="fab fa-whatsapp"></i> {{ store.isArabic ? 'واتساب' : 'WhatsApp' }}
              </button>
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
              <th v-for="column in config.columns" :key="column.key">{{ store.isArabic && column.labelAr ? column.labelAr : column.label }}</th>
              <th class="actions-col">{{ store.isArabic ? 'إجراءات' : 'Actions' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)">
              <td v-for="column in config.columns" :key="column.key" :data-label="store.isArabic && column.labelAr ? column.labelAr : column.label">
                <template v-if="(isAppointments || isDeals) && column.key === 'status'">
                  <span class="status-pill" :class="statusClass(String(row.status))">{{ readableStatus(String(row.status)) }}</span>
                </template>
                <template v-else-if="isDeals && column.key === 'referenceNumber'">
                  <router-link class="record-link" :to="`/deals/${row.id}`">
                    {{ display(row[column.key], column, row) }}
                  </router-link>
                </template>
                <template v-else-if="isLeads && column.key === 'nextFollowUpAt' && row[column.key]">
                  <span class="follow-up-pill" :class="followUpClass(row[column.key])">
                    {{ display(row[column.key], column, row) }}
                    <small v-if="followUpBucketOf(row[column.key]) === 'overdue'">
                      {{ store.isArabic ? 'متأخرة' : 'overdue' }}
                    </small>
                    <small v-else-if="followUpBucketOf(row[column.key]) === 'today'">
                      {{ store.isArabic ? 'اليوم' : 'today' }}
                    </small>
                  </span>
                </template>
                <template v-else-if="isLeads && column.key === 'priorityTier'">
                  <span class="priority-pill" :class="`priority-${String(row[column.key] || 'MEDIUM').toLowerCase()}`">
                    {{ priorityLabel(String(row[column.key] || 'MEDIUM')) }}
                  </span>
                </template>
                <template v-else-if="isLeads && column.key === 'priorityScore'">
                  <span class="priority-score">{{ row[column.key] ?? 0 }}</span>
                </template>
                <template v-else-if="isPayments && column.key === 'aging'">
                  <span class="aging-pill" :class="`aging-${String((row.aging as { bucket?: string } | undefined)?.bucket || 'CURRENT')}`">
                    {{ agingLabel(String((row.aging as { bucket?: string } | undefined)?.bucket || 'CURRENT'), store.isArabic) }}
                  </span>
                </template>
                <template v-else-if="isMaintenance && column.key === 'cost'">
                  <span class="expense-tag" :class="linkedExpenseId(row) ? 'linked' : 'none'">
                    {{ linkedExpenseLabel(row) }}
                  </span>
                  <small class="cost-value">{{ display(row[column.key], column, row) }}</small>
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
                <router-link v-if="isLeads" class="link" :to="`/leads/${row.id}`">
                  {{ store.isArabic ? 'عرض' : 'View' }}
                </router-link>
                <button v-if="props.resource === 'leads'" type="button" class="link" @click="openMatches(row)">
                  {{ store.isArabic ? '???????' : 'Matches' }}
                </button>
                <button v-if="props.resource === 'leads'" type="button" class="link" @click="openActivity(row)">
                  {{ store.isArabic ? '??????' : 'Activity' }}
                </button>
                <button v-if="isLeads" type="button" class="link whatsapp-link" :title="store.isArabic ? 'مراسلة عبر واتساب' : 'Chat on WhatsApp'" @click="whatsappForLead(row)">
                  <i class="fab fa-whatsapp"></i> {{ store.isArabic ? 'واتساب' : 'WhatsApp' }}
                </button>
                <button v-if="isLeads" type="button" class="link" @click="openFollowUp(row)">
                  {{ store.isArabic ? 'متابعة' : 'Follow up' }}
                </button>
                <button v-if="isPayments" type="button" class="link whatsapp-link" :title="store.isArabic ? 'تذكير بدفعة عبر واتساب' : 'Send WhatsApp payment reminder'" @click="whatsappForPayment(row)">
                  <i class="fab fa-whatsapp"></i> {{ store.isArabic ? 'واتساب' : 'WhatsApp' }}
                </button>
                <button v-if="isLeads" type="button" class="link" :disabled="prioritySaving === String(row.id)" @click="recomputePriority(row)">
                  {{ prioritySaving === String(row.id)
                    ? (store.isArabic ? 'جارٍ الحساب…' : 'Recalculating…')
                    : (store.isArabic ? 'إعادة حساب الأولوية' : 'Recalc priority') }}
                </button>
                <router-link v-if="isMaintenance && linkedExpenseId(row)" class="link" to="/finance/expenses">
                  {{ store.isArabic ? 'المصروف' : 'Expense' }}
                </router-link>
                <button v-if="isUsers && (!row.isActive || row.deletedAt)" type="button" class="link" @click="restoreUser(row)">
                  {{ store.isArabic ? 'تفعيل' : 'Restore' }}
                </button>
                <button v-if="isUsers && store.user?.role === 'ADMIN'" type="button" class="link" @click="resetUserPassword(row)">
                  {{ store.isArabic ? 'إعادة تعيين كلمة المرور' : 'Reset password' }}
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
              <span>{{ store.isArabic && field.labelAr ? field.labelAr : field.label }}{{ field.required ? ' *' : '' }}</span>
              <select v-if="field.type === 'select'" v-model="form[field.key]" :required="field.required">
                <option value="">—</option>
                <option v-for="(option, optionIndex) in field.options" :key="option" :value="option">
                  {{ store.isArabic && field.optionsAr?.[optionIndex] ? field.optionsAr[optionIndex] : option }}
                </option>
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
              <span>{{ store.isArabic && field.labelAr ? field.labelAr : field.label }}</span>
            </template>
          </label>
          <label v-if="showRecordExpense" class="checkbox record-expense">
            <input v-model="recordExpense" type="checkbox" />
            <span>{{ store.isArabic ? 'تسجيل مصروف عند الإكمال' : 'Record expense on completion' }}</span>
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

    <div v-if="followUpOpen && followUpLead" class="overlay" @click.self="followUpOpen = false">
      <form class="modal" @submit.prevent="onSaveFollowUp">
        <div class="modal-head">
          <h2>{{ store.isArabic ? 'تسجيل متابعة' : 'Log follow-up' }}</h2>
          <button type="button" aria-label="Close" @click="followUpOpen = false">×</button>
        </div>
        <div class="modal-body">
          <p class="follow-up-lead">{{ leadLabel(followUpLead) }}</p>
          <button type="button" class="btn btn-whatsapp no-print" @click="whatsappForLead(followUpLead)">
            <i class="fab fa-whatsapp"></i>
            {{ store.isArabic ? 'مراسلة العميل عبر واتساب' : 'Message lead on WhatsApp' }}
          </button>
          <label>
            <span>{{ store.isArabic ? 'الملاحظة' : 'Note' }} *</span>
            <textarea v-model="followUpBody" rows="4" required maxlength="2000"></textarea>
          </label>
          <label>
            <span>{{ store.isArabic ? 'المتابعة القادمة (اختياري)' : 'Next follow-up (optional)' }}</span>
            <input v-model="followUpNext" type="datetime-local" />
          </label>
          <p class="muted">
            {{ store.isArabic
              ? 'سيتم تسجيل وقت آخر تواصل تلقائياً.'
              : 'Last contacted is stamped automatically.' }}
          </p>
          <div v-if="followUpError" class="error" role="alert">{{ followUpError }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit" :disabled="followUpSaving">
            {{ followUpSaving ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}
          </button>
          <button class="btn btn-quiet" type="button" @click="followUpOpen = false">
            {{ store.isArabic ? 'إلغاء' : 'Cancel' }}
          </button>
        </div>
      </form>
    </div>

    <ImportCsvModal
      :open="importOpen"
      kind="leads"
      :busy="importBusy"
      :preview="importPreview"
      :error="importError"
      :result-message="importMessage"
      @close="importOpen = false"
      @preview="onImportPreview"
      @commit="onImportCommit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import ImportCsvModal from '@/components/ImportCsvModal.vue'
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
import type { CsvImportPreview } from '@/utils/csvImport'
import { followUpBucket, type FollowUpBucket } from '@/utils/followUps'
import { agingLabel, PAYMENT_AGING_BUCKETS } from '@/utils/paymentAging'
import { openWhatsAppChat } from '@/utils/whatsapp'
import { useStore } from '@/stores'
import type { ApiWarning, AppointmentConflictInfo } from '@/types'

const props = defineProps<{ resource: string }>()
const router = useRouter()
const store = useStore()
const config = computed<ResourceConfig>(() => resources[props.resource] || resources.leads)
const isAppointments = computed(() => props.resource === 'appointments')
const isDeals = computed(() => props.resource === 'deals')
const isLeads = computed(() => props.resource === 'leads')
const isPayments = computed(() => props.resource === 'payments')
const isMaintenance = computed(() => props.resource === 'maintenance')
const isUsers = computed(() => props.resource === 'users')

type Row = Record<string, unknown> & { id: string }
const rows = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const recordExpense = ref(true)
const maintenanceWasCompleted = ref(false)
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
const followUpFilter = ref('')
const sourceFilter = ref('')
const priorityFilter = ref('')
const budgetMinFilter = ref('')
const budgetMaxFilter = ref('')
const sortFilter = ref('priority_desc')
const agingFilter = ref('')
const includeInactive = ref(false)
const paymentAgingBuckets = PAYMENT_AGING_BUCKETS
const prioritySaving = ref<string | null>(null)
const priorityTiers = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const leadSources = computed(() => Array.from(new Set(
  rows.value.map((row) => String(row.source || '').trim()).filter(Boolean)
)).sort((a, b) => a.localeCompare(b)))
const followUpOpen = ref(false)
const followUpLead = ref<Row | null>(null)
const followUpBody = ref('')
const followUpNext = ref('')
const followUpSaving = ref(false)
const followUpError = ref('')
const importOpen = ref(false)
const importBusy = ref(false)
const importPreview = ref<CsvImportPreview | null>(null)
const importError = ref('')
const importMessage = ref('')

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

const showRecordExpense = computed(() =>
  isMaintenance.value &&
  Boolean(editingId.value) &&
  String(form.status || '') === 'COMPLETED' &&
  !maintenanceWasCompleted.value
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

function priorityLabel(tier: string): string {
  if (tier === 'URGENT') return store.isArabic ? 'عاجل' : 'Urgent'
  if (tier === 'HIGH') return store.isArabic ? 'مرتفع' : 'High'
  if (tier === 'LOW') return store.isArabic ? 'منخفض' : 'Low'
  return store.isArabic ? 'متوسط' : 'Medium'
}

function clearLeadFilters(): void {
  sourceFilter.value = ''
  priorityFilter.value = ''
  budgetMinFilter.value = ''
  budgetMaxFilter.value = ''
  sortFilter.value = 'priority_desc'
  followUpFilter.value = ''
}

async function recomputePriority(row: Row): Promise<void> {
  prioritySaving.value = String(row.id)
  try {
    const response = await apiPost<Row>(`/leads/${row.id}/recompute-priority`, {})
    if (response.data) rows.value = rows.value.map((item) => item.id === row.id ? { ...item, ...response.data } : item)
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    prioritySaving.value = null
  }
}

watch(config, () => { void load() })
watch(statusFilter, () => { void load() })
watch(followUpFilter, () => { void load() })
watch([sourceFilter, priorityFilter, budgetMinFilter, budgetMaxFilter, sortFilter], () => {
  if (isLeads.value) void load()
})
watch(agingFilter, () => { if (isPayments.value) void load() })
watch(includeInactive, () => { if (isUsers.value) void load() })

onMounted(() => { void load(); applyQueryPrefill() })

async function load(): Promise<void> {
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 100 }
    if (isDeals.value && statusFilter.value) params.status = statusFilter.value
    if (isPayments.value && agingFilter.value) params.aging = agingFilter.value
    if (isUsers.value && includeInactive.value) params.includeInactive = true
    if (isLeads.value) {
      if (followUpFilter.value) params.followUp = followUpFilter.value
      if (sourceFilter.value.trim()) params.source = sourceFilter.value.trim()
      if (priorityFilter.value) params.priority = priorityFilter.value
      if (budgetMinFilter.value !== '') params.budgetMin = budgetMinFilter.value
      if (budgetMaxFilter.value !== '') params.budgetMax = budgetMaxFilter.value
      if (sortFilter.value) params.sort = sortFilter.value
    }
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
  recordExpense.value = true
  maintenanceWasCompleted.value = false
  formOpen.value = true
}

function applyQueryPrefill(): void {
  const q = router.currentRoute.value.query
  if (isLeads.value && typeof q.followUp === 'string' && ['overdue', 'today', 'upcoming'].includes(q.followUp)) {
    followUpFilter.value = q.followUp
  }
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
  recordExpense.value = true
  maintenanceWasCompleted.value = isMaintenance.value && String(row.status || '') === 'COMPLETED'
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

function leadLabel(lead: Row): string {
  return `${lead.firstName || ''}${lead.lastName ? ` ${lead.lastName}` : ''}`.trim() || String(lead.email || 'Lead')
}

// Package 26: WhatsApp click-to-chat. Only public contact/listing fields are
// placed in messages; internal notes are deliberately never read here.
const whatsappLanguage = () => (store.isArabic ? 'ar' : 'en') as 'ar' | 'en'

function reportWhatsAppUnavailable(): void {
  store.error = store.isArabic
    ? 'لا يوجد رقم واتساب صالح لهذا السجل.'
    : 'No valid WhatsApp phone number is available for this record.'
}

async function leadById(leadId: unknown): Promise<Row | null> {
  if (leadId === null || leadId === undefined || leadId === '') return null
  try {
    const response = await apiGet<Row>(`/leads/${encodeURIComponent(String(leadId))}`)
    return response.data || null
  } catch {
    return null
  }
}

function whatsappForLead(row: Row): void {
  const opened = openWhatsAppChat({
    phone: row.phone,
    template: 'leadFollowUp',
    payload: { customerName: leadLabel(row), title: row.propertyTitle as string | undefined },
    language: whatsappLanguage()
  })
  if (!opened) reportWhatsAppUnavailable()
}

async function whatsappForAppointment(row: Row): Promise<void> {
  const lead = await leadById(row.leadId)
  const opened = openWhatsAppChat({
    phone: lead?.phone || row.phone,
    template: 'appointmentReminder',
    payload: {
      customerName: lead ? leadLabel(lead) : undefined,
      title: row.title as string | undefined,
      startsAt: row.startsAt as string | undefined
    },
    language: whatsappLanguage()
  })
  if (!opened) reportWhatsAppUnavailable()
}

async function whatsappForPayment(row: Row): Promise<void> {
  let deal: Record<string, unknown> | null = null
  try {
    const response = await apiGet<Record<string, unknown>>(`/deals/${encodeURIComponent(String(row.dealId))}`)
    deal = response.data || null
  } catch {
    deal = null
  }
  const lead = await leadById(deal?.leadId)
  const payments = Array.isArray(deal?.payments) ? deal?.payments as Array<Record<string, unknown>> : []
  const paid = payments
    .filter((payment) => payment.status === 'COMPLETED')
    .reduce((total, payment) => total + Number(payment.amount || 0), 0)
  const remainingBalance = Math.max(0, Number(deal?.amount || 0) - paid)
  const opened = openWhatsAppChat({
    phone: lead?.phone,
    template: 'installmentReminder',
    payload: {
      customerName: lead ? leadLabel(lead as Row) : undefined,
      reference: deal?.referenceNumber as string | undefined,
      dueDate: row.dueAt as string | undefined,
      amount: row.amount as string | number | undefined,
      remainingBalance: String(remainingBalance),
      currency: (row.currency || deal?.currency) as string | undefined
    },
    language: whatsappLanguage()
  })
  if (!opened) reportWhatsAppUnavailable()
}

function linkedExpenseId(row: Row): string | null {
  const value = row.linkedExpenseId ?? row.expenseId
  return value === null || value === undefined || value === '' ? null : String(value)
}

function linkedExpenseLabel(row: Row): string {
  if (!linkedExpenseId(row)) return store.isArabic ? 'بدون مصروف' : 'No expense'
  const status = typeof row.linkedExpenseStatus === 'string' && row.linkedExpenseStatus.trim()
    ? readableStatus(row.linkedExpenseStatus)
    : null
  return status || (store.isArabic ? 'مصروف مرتبط' : 'Linked expense')
}

type ImportPayload = { csv: string; dryRun: boolean }

function csvOf(payload: ImportPayload | string): string {
  return typeof payload === 'string' ? payload : payload.csv
}

function openImport(): void {
  importPreview.value = null
  importError.value = ''
  importMessage.value = ''
  importOpen.value = true
}

async function onImportPreview(payload: ImportPayload | string): Promise<void> {
  const csv = csvOf(payload)
  importBusy.value = true
  importError.value = ''
  importMessage.value = ''
  try {
    const response = await apiPost<{ preview: CsvImportPreview }>('/leads/import', { csv, dryRun: true })
    importPreview.value = response.data?.preview ?? null
  } catch (error) {
    importPreview.value = null
    importError.value = errorMessage(error)
  } finally {
    importBusy.value = false
  }
}

async function onImportCommit(payload: ImportPayload | string): Promise<void> {
  const csv = csvOf(payload)
  importBusy.value = true
  importError.value = ''
  importMessage.value = ''
  try {
    const response = await apiPost<{ created?: number }>('/leads/import', { csv, dryRun: false })
    importMessage.value = store.isArabic
      ? `تم استيراد ${response.data?.created ?? 0} عميل محتمل.`
      : `Created ${response.data?.created ?? 0} leads.`
    await load()
    importOpen.value = false
  } catch (error) {
    importError.value = errorMessage(error)
  } finally {
    importBusy.value = false
  }
}

function followUpBucketOf(value: unknown): FollowUpBucket | null {
  return followUpBucket(value == null || value === '' ? null : String(value))
}

function followUpClass(value: unknown): string {
  const bucket = followUpBucketOf(value)
  return bucket ? `follow-up-${bucket}` : ''
}

function openFollowUp(row: Row): void {
  followUpLead.value = row
  followUpBody.value = ''
  followUpNext.value = ''
  followUpError.value = ''
  followUpOpen.value = true
}

async function onSaveFollowUp(): Promise<void> {
  if (!followUpLead.value || !followUpBody.value.trim()) return
  followUpSaving.value = true
  followUpError.value = ''
  try {
    await apiPost(`${config.value.endpoint}/${followUpLead.value.id}/follow-ups`, {
      body: followUpBody.value.trim(),
      nextFollowUpAt: followUpNext.value || null
    })
    followUpOpen.value = false
    await load()
  } catch (e) {
    followUpError.value = errorMessage(e)
  } finally {
    followUpSaving.value = false
  }
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
  if (showRecordExpense.value) payload.recordExpense = recordExpense.value
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

/** Package 30: ADMIN-only password reset; the target's sessions are revoked. */
async function resetUserPassword(row: Row): Promise<void> {
  const password = window.prompt(
    store.isArabic ? 'كلمة المرور الجديدة للمستخدم (8 أحرف على الأقل، حرف ورقم):' : 'New user password (at least 8 characters, letter and number):'
  )
  if (!password) return
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    store.error = store.isArabic
      ? 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وتحتوي على حرف ورقم.'
      : 'Password must be at least 8 characters and include a letter and a number.'
    return
  }
  try {
    await apiPatch(`${config.value.endpoint}/${row.id}`, { password })
    await load()
  } catch (e) {
    store.error = errorMessage(e)
  }
}

/** Package 30: reactivate a soft-deleted account without changing its role. */
async function restoreUser(row: Row): Promise<void> {
  try {
    await apiPost(`${config.value.endpoint}/${row.id}/restore`, {})
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
.btn-whatsapp { background: #e7f7f2; color: #075e54; border: 1px solid #b7e4d8; margin-bottom: 0.8rem; }
.head-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.view-toggle { display: inline-flex; border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden; }
.view-toggle button { border: 0; background: #fff; color: #374151; padding: 0.55rem 0.8rem; font-size: 0.82rem; cursor: pointer; }
.view-toggle button.active { background: #e0e7ff; color: #3730a3; font-weight: 600; }
.warning { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 10px; padding: 0.75rem 0.9rem; font-size: 0.84rem; }
.warning ul { margin: 0.4rem 0 0; padding-inline-start: 1.2rem; }
.status-pill { display: inline-block; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.72rem; background: #e0e7ff; color: #3730a3; }
.aging-filters { display: flex; gap: 0.6rem; align-items: end; margin-bottom: 0.8rem; }
.aging-filters label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
.user-filters { display: flex; align-items: center; margin-bottom: 0.8rem; }
.checkbox-line { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: #374151; }
.aging-pill { display: inline-block; white-space: nowrap; border-radius: 999px; padding: 0.15rem 0.5rem; font-size: 0.72rem; background: #f3f4f6; color: #4b5563; }
.aging-1_30_DAYS { background: #fef3c7; color: #92400e; }
.aging-31_60_DAYS { background: #ffedd5; color: #9a3412; }
.aging-60_PLUS_DAYS { background: #fee2e2; color: #991b1b; }
.aging-PAID { background: #dcfce7; color: #166534; }
.status-draft { background: #f3f4f6; color: #4b5563; }
.status-pending { background: #fef3c7; color: #92400e; }
.status-active { background: #e0e7ff; color: #3730a3; }
.status-completed { background: #dcfce7; color: #166534; }
.status-cancelled, .status-no-show { background: #fee2e2; color: #991b1b; }
.follow-up-pill { display: inline-flex; align-items: center; gap: 0.3rem; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.74rem; background: #e0e7ff; color: #3730a3; white-space: nowrap; }
.follow-up-pill small { font-size: 0.66rem; text-transform: uppercase; }
.follow-up-overdue { background: #fee2e2; color: #991b1b; }
.follow-up-today { background: #fef3c7; color: #92400e; }
.follow-up-lead { margin: 0 0 0.4rem; font-weight: 600; color: #111827; }
.import-summary { background: #ecfdf5; color: #166534; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.84rem; }
.expense-tag { display: inline-block; border-radius: 999px; padding: 0.12rem 0.45rem; font-size: 0.68rem; margin-inline-end: 0.35rem; }
.expense-tag.linked { background: #dcfce7; color: #166534; }
.expense-tag.none { background: #f3f4f6; color: #6b7280; }
.cost-value { color: #374151; }
.stage-filter { display: inline-flex; flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #374151; }
.stage-filter select { padding: 0.4rem 0.5rem; font-size: 0.82rem; }
.lead-filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: end; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.7rem 0.8rem; margin-bottom: 0.9rem; }
.lead-filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: #6b7280; }
.lead-filters input, .lead-filters select { min-width: 130px; padding: 0.4rem 0.5rem; font-size: 0.82rem; border: 1px solid #d1d5db; border-radius: 7px; background: #fff; color: #111827; }
.priority-pill { display: inline-block; border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.72rem; background: #f3f4f6; color: #4b5563; white-space: nowrap; }
.priority-high { background: #fef3c7; color: #92400e; }
.priority-urgent { background: #fee2e2; color: #991b1b; }
.priority-low { background: #dcfce7; color: #166534; }
.priority-score { font-variant-numeric: tabular-nums; }
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
.record-expense { grid-column: 1 / -1; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.88rem; font-family: inherit; }
.error { grid-column: 1 / -1; background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.84rem; }
.modal-actions { display: flex; gap: 0.6rem; padding: 1rem 1.2rem; border-top: 1px solid #eef2f7; }
.whatsapp-link { color: #128c7e; white-space: nowrap; }
@media (max-width: 640px) {
  th, td { padding: 0.55rem 0.6rem; }
  .agenda-item { grid-template-columns: 1fr; }
  .agenda-side { justify-content: flex-start; }
}
</style>
