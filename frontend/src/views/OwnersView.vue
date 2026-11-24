<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'المالكون' : 'Owners' }}</h1>
        <p class="muted">{{ pagination.total }} {{ store.isArabic ? 'سجل' : 'records' }}</p>
      </div>
      <div class="head-actions">
        <form class="search" @submit.prevent="load(1)">
          <input v-model="search" type="search" :placeholder="store.isArabic ? 'بحث بالاسم أو الهاتف أو البريد' : 'Search name, phone, or email'" />
          <button class="btn btn-quiet" type="submit">{{ store.isArabic ? 'بحث' : 'Search' }}</button>
        </form>
        <label class="toggle"><input v-model="includeInactive" type="checkbox" @change="load(1)" /> {{ store.isArabic ? 'عرض المؤرشف' : 'Include archived' }}</label>
        <button v-if="store.canManage" class="btn btn-primary" type="button" @click="openCreate">
          <i class="fas fa-plus"></i> {{ store.isArabic ? 'إضافة' : 'Add' }}
        </button>
      </div>
    </div>

    <div v-if="loadingState" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!rows.length" class="state">{{ store.isArabic ? 'لا توجد سجلات.' : 'No owners found.' }}</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
            <th>{{ store.isArabic ? 'البريد/الهاتف' : 'Email / Phone' }}</th>
            <th>{{ store.isArabic ? 'المدينة' : 'City' }}</th>
            <th>{{ store.isArabic ? 'العقارات' : 'Properties' }}</th>
            <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
            <th class="actions-col">{{ store.isArabic ? 'إجراءات' : 'Actions' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.displayName || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.companyName || '—' }}</td>
            <td>{{ [row.email, row.phone].filter(Boolean).join(' · ') || '—' }}</td>
            <td>{{ [row.city, row.country].filter(Boolean).join(', ') || '—' }}</td>
            <td>{{ row._count?.properties ?? row.properties?.length ?? 0 }}</td>
            <td><span class="tag" :class="row.isActive ? 'active' : 'inactive'">{{ row.isActive ? (store.isArabic ? 'نشط' : 'Active') : (store.isArabic ? 'مؤرشف' : 'Archived') }}</span></td>
            <td class="actions-col">
              <button class="link" type="button" @click="openStatement(row)">{{ store.isArabic ? 'كشف الحساب' : 'Statement' }}</button>
              <button v-if="store.canManage" class="link" type="button" @click="copyPortalLink(row)">{{ store.isArabic ? 'رابط البوابة' : 'Portal link' }}</button>
              <button class="link" type="button" @click="openDetails(row)">{{ store.isArabic ? 'عرض' : 'View' }}</button>
              <button v-if="store.canManage" class="link" type="button" @click="openEdit(row)">{{ store.isArabic ? 'تعديل' : 'Edit' }}</button>
              <button v-if="store.canManage && row.isActive" class="link danger" type="button" @click="archiveOwner(row)">{{ store.isArabic ? 'أرشفة' : 'Archive' }}</button>
              <button v-if="store.canManage && !row.isActive" class="link" type="button" @click="restoreOwner(row)">{{ store.isArabic ? 'استعادة' : 'Restore' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pager">
      <button type="button" :disabled="page <= 1" @click="load(page - 1)">{{ store.isArabic ? '›' : '‹' }}</button>
      <span>{{ page }} / {{ pagination.pages }}</span>
      <button type="button" :disabled="page >= pagination.pages" @click="load(page + 1)">{{ store.isArabic ? '‹' : '›' }}</button>
    </div>

    <div v-if="formOpen" class="overlay" @click.self="closeForm">
      <form class="modal" @submit.prevent="save">
        <div class="modal-head">
          <h2>{{ editingId ? (store.isArabic ? 'تعديل مالك' : 'Edit owner') : (store.isArabic ? 'مالك جديد' : 'New owner') }}</h2>
          <button type="button" :aria-label="store.isArabic ? 'إغلاق' : 'Close'" @click="closeForm">×</button>
        </div>
        <div class="modal-body">
          <label><span>{{ store.isArabic ? 'الاسم الأول' : 'First name' }}</span><input v-model="form.firstName" maxlength="100" /></label>
          <label><span>{{ store.isArabic ? 'اسم العائلة' : 'Last name' }}</span><input v-model="form.lastName" maxlength="100" /></label>
          <label><span>{{ store.isArabic ? 'اسم الشركة' : 'Company name' }}</span><input v-model="form.companyName" maxlength="200" /></label>
          <label><span>{{ store.isArabic ? 'البريد الإلكتروني' : 'Email' }}</span><input v-model="form.email" type="email" maxlength="254" /></label>
          <label><span>{{ store.isArabic ? 'الهاتف' : 'Phone' }}</span><input v-model="form.phone" maxlength="50" /></label>
          <label><span>{{ store.isArabic ? 'العنوان' : 'Address' }}</span><input v-model="form.address" maxlength="500" /></label>
          <label><span>{{ store.isArabic ? 'المدينة' : 'City' }}</span><input v-model="form.city" maxlength="120" /></label>
          <label><span>{{ store.isArabic ? 'الدولة' : 'Country' }}</span><input v-model="form.country" maxlength="120" /></label>
          <label class="full"><span>{{ store.isArabic ? 'ملاحظات' : 'Notes' }}</span><textarea v-model="form.notes" rows="3" maxlength="5000"></textarea></label>
          <label class="checkbox"><input v-model="form.isActive" type="checkbox" /><span>{{ store.isArabic ? 'نشط' : 'Active' }}</span></label>
          <div v-if="formError" class="error full">{{ formError }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}</button>
          <button class="btn btn-quiet" type="button" @click="closeForm">{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</button>
        </div>
      </form>
    </div>

    <div v-if="selected" class="overlay" @click.self="selected = null">
      <section class="modal">
        <div class="modal-head">
          <h2>{{ selected.displayName || [selected.firstName, selected.lastName].filter(Boolean).join(' ') || selected.companyName || (store.isArabic ? 'تفاصيل المالك' : 'Owner details') }}</h2>
          <button type="button" :aria-label="store.isArabic ? 'إغلاق' : 'Close'" @click="selected = null">×</button>
        </div>
        <div class="modal-body details">
          <p><strong>{{ store.isArabic ? 'البريد' : 'Email' }}:</strong> {{ selected.email || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الهاتف' : 'Phone' }}:</strong> {{ selected.phone || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الموقع' : 'Location' }}:</strong> {{ [selected.address, selected.city, selected.country].filter(Boolean).join(', ') || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الحالة' : 'Status' }}:</strong> {{ selected.isActive ? (store.isArabic ? 'نشط' : 'Active') : (store.isArabic ? 'مؤرشف' : 'Archived') }}</p>
          <div v-if="store.canManage" class="full portal-panel">
            <div class="payout-head">
              <h3>{{ store.isArabic ? 'بوابة المالك' : 'Owner portal' }}</h3>
              <span class="tag" :class="portalLink?.enabled ? 'active' : 'inactive'">
                {{ portalLink?.enabled ? (store.isArabic ? 'مفعّلة' : 'Enabled') : (store.isArabic ? 'غير مفعّلة' : 'Disabled') }}
              </span>
            </div>
            <p class="muted">
              {{ store.isArabic ? 'رابط للقراءة فقط ويمكن إلغاؤه أو تجديده في أي وقت.' : 'Read-only link that can be revoked or rotated at any time.' }}
            </p>
            <div class="portal-actions">
              <button class="btn btn-primary" type="button" :disabled="portalBusy" @click="copyPortalLink(selected)">
                {{ store.isArabic ? 'نسخ الرابط' : 'Copy link' }}
              </button>
              <button class="btn btn-quiet" type="button" :disabled="portalBusy || !portalLink?.enabled" @click="regeneratePortalLink(selected)">
                {{ store.isArabic ? 'تجديد الرابط' : 'Regenerate' }}
              </button>
              <button class="btn btn-quiet" type="button" :disabled="portalBusy || !portalLink?.enabled" @click="revokePortalLink(selected)">
                {{ store.isArabic ? 'إلغاء الرابط' : 'Revoke' }}
              </button>
            </div>
            <p v-if="portalMessage" class="muted">{{ portalMessage }}</p>
          </div>
          <p v-if="selected.notes"><strong>{{ store.isArabic ? 'ملاحظات' : 'Notes' }}:</strong> {{ selected.notes }}</p>
          <div class="full">
            <h3>{{ store.isArabic ? 'العقارات المرتبطة' : 'Associated properties' }}</h3>
            <div v-if="detailsLoading" class="empty">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
            <div v-else-if="!selected.properties?.length" class="empty">{{ store.isArabic ? 'لا توجد عقارات مرتبطة.' : 'No associated properties.' }}</div>
            <ul v-else class="prop-list">
              <li v-for="property in selected.properties" :key="property.id">
                <router-link :to="`/properties/${property.id}`" @click="selected = null">
                  {{ property.referenceNumber }} — {{ property.title }} ({{ statusLabel(property.status) }})
                </router-link>
              </li>
            </ul>
          </div>
          <ActivityTimeline
            v-if="selected"
            class="full"
            :key="selected.id"
            entity-type="Owner"
            :entity-id="selected.id"
            :limit="10"
            :show-filters="false"
          />
          <div class="full payouts">
            <div class="payout-head">
              <h3>{{ store.isArabic ? 'المدفوعات للمالك' : 'Owner payouts' }}</h3>
              <button v-if="store.canManage" class="btn btn-quiet" type="button" @click="openPayoutForm">
                <i class="fas fa-plus"></i> {{ store.isArabic ? 'تسجيل دفعة' : 'Record payout' }}
              </button>
            </div>
            <p v-if="payoutSummary" class="muted">
              {{ store.isArabic ? 'قيد الانتظار' : 'Pending' }}: {{ payoutSummary.pending }} ·
              {{ store.isArabic ? 'مسدد' : 'Settled' }}: {{ payoutSummary.settled }}
            </p>
            <div v-if="payoutFormOpen" class="payout-form">
              <label><span>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</span><input v-model="payoutForm.amount" type="number" min="0" step="0.01" /></label>
              <label><span>{{ store.isArabic ? 'العملة' : 'Currency' }}</span><input v-model="payoutForm.currency" maxlength="3" /></label>
              <label><span>{{ store.isArabic ? 'المرجع' : 'Reference' }}</span><input v-model="payoutForm.reference" maxlength="120" /></label>
              <label><span>{{ store.isArabic ? 'من تاريخ' : 'Period start' }}</span><input v-model="payoutForm.periodStart" type="date" /></label>
              <label><span>{{ store.isArabic ? 'إلى تاريخ' : 'Period end' }}</span><input v-model="payoutForm.periodEnd" type="date" /></label>
              <label class="full"><span>{{ store.isArabic ? 'ملاحظات' : 'Notes' }}</span><textarea v-model="payoutForm.notes" rows="2" maxlength="5000"></textarea></label>
              <div class="payout-actions full">
                <button class="btn btn-primary" type="button" :disabled="payoutSaving" @click="savePayout">
                  {{ payoutSaving ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}
                </button>
                <button class="btn btn-quiet" type="button" @click="payoutFormOpen = false">{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</button>
              </div>
            </div>
            <p v-if="payoutError" class="error" role="alert">{{ payoutError }}</p>
            <div v-if="payoutsLoading" class="empty">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
            <div v-else-if="!payouts.length" class="empty">{{ store.isArabic ? 'لا توجد مدفوعات مسجلة.' : 'No payouts recorded.' }}</div>
            <ul v-else class="payout-list">
              <li v-for="payout in payouts" :key="payout.id">
                <span><strong>{{ payout.amount }} {{ payout.currency }}</strong> · {{ payout.reference || '—' }}</span>
                <span class="tag" :class="String(payout.status).toLowerCase()">{{ payoutStatusLabel(payout.status) }}</span>
                <button v-if="store.canManage && payout.status === 'PENDING'" class="link" type="button" @click="settlePayout(payout)">
                  {{ store.isArabic ? 'تحديد كمسدد' : 'Mark settled' }}
                </button>
                <time v-if="payout.settledAt" :datetime="payout.settledAt">{{ formatDate(payout.settledAt) }}</time>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>

    <div v-if="statementOpen" class="overlay print-statement-modal" @click.self="closeStatement">
      <section class="modal statement-modal">
        <div class="modal-head">
          <h2>{{ store.isArabic ? 'كشف المالك' : 'Owner Statement' }}</h2>
          <button type="button" :aria-label="store.isArabic ? 'إغلاق' : 'Close'" @click="closeStatement">×</button>
        </div>
        <div class="statement-subtitle muted">
          {{ statementOwner?.displayName || [statementOwner?.firstName, statementOwner?.lastName].filter(Boolean).join(' ') || statementOwner?.companyName || '—' }}
          <span v-if="statement">· {{ formatDate(statement.generatedAt) }}</span>
        </div>
        <div v-if="statementLoading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading statement…' }}</div>
        <div v-else-if="statementError" class="error inline-error">{{ statementError }}</div>
        <div v-else-if="statement" class="statement-body">
          <div class="print-only print-brand">
            <div class="print-brand-top">
              <strong>EstateOS</strong>
              <span>{{ printGeneratedAt }}</span>
            </div>
            <h1>{{ store.isArabic ? 'كشف المالك' : 'Owner portfolio statement' }}</h1>
            <p>
              {{ statementOwner?.displayName || [statementOwner?.firstName, statementOwner?.lastName].filter(Boolean).join(' ') || statementOwner?.companyName || '—' }}
              <span v-if="statement">· {{ formatDate(statement.generatedAt) }}</span>
            </p>
          </div>

          <div class="summary-cards">
            <div class="summary-card">
              <span>{{ store.isArabic ? 'العقارات' : 'Properties' }}</span>
              <strong>{{ statement.properties.count }}</strong>
              <small>{{ statement.properties.activeCount }} {{ store.isArabic ? 'نشط' : 'active' }}</small>
            </div>
            <div class="summary-card">
              <span>{{ store.isArabic ? 'الصفقات' : 'Deals' }}</span>
              <strong>{{ statement.deals.count }}</strong>
              <small>{{ Object.keys(statement.deals.byStatus || {}).length }} {{ store.isArabic ? 'حالة' : 'statuses' }}</small>
            </div>
          </div>

          <section class="statement-section">
            <h3>{{ store.isArabic ? 'تفصيل حسب العملة' : 'Currency breakdown' }}</h3>
            <p v-if="statement.financialsRestricted" class="notice">
              {{ store.isArabic ? 'الأرقام المالية متاحة لأدوار المالية فقط.' : 'Financial figures are available to finance roles only.' }}
            </p>
            <div v-else-if="!statement.financials?.currencies.length" class="empty">
              {{ store.isArabic ? 'لا توجد بيانات مالية مرتبطة.' : 'No financial activity recorded.' }}
            </div>
            <div v-else class="table-wrap statement-table">
              <table>
                <thead>
                  <tr>
                    <th>{{ store.isArabic ? 'العملة' : 'Currency' }}</th>
                    <th>{{ store.isArabic ? 'العقارات / القيمة' : 'Properties / value' }}</th>
                    <th>{{ store.isArabic ? 'الصفقات / المبلغ' : 'Deals / amount' }}</th>
                    <th>{{ store.isArabic ? 'المحصل' : 'Collected' }}</th>
                    <th>{{ store.isArabic ? 'المصروفات' : 'Expenses' }}</th>
                    <th>{{ store.isArabic ? 'الصافي' : 'Net' }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in statement.financials?.currencies" :key="row.currency">
                    <td><span class="tag">{{ row.currency }}</span></td>
                    <td>{{ row.properties.count }} · {{ row.properties.listedValue }}</td>
                    <td>{{ row.deals.count }} · {{ row.deals.amount }}</td>
                    <td>{{ row.payments.collected }} ({{ row.payments.count }})</td>
                    <td>{{ row.expenses.paid }} ({{ row.expenses.count }})</td>
                    <td><strong>{{ row.net }}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="statement-section">
            <h3>{{ store.isArabic ? 'العقارات المرتبطة' : 'Linked properties' }}</h3>
            <div v-if="!statement.properties.list.length" class="empty">
              {{ store.isArabic ? 'لا توجد عقارات مرتبطة.' : 'No associated properties.' }}
            </div>
            <ul v-else class="prop-list">
              <li v-for="property in statement.properties.list" :key="property.id">
                <router-link :to="`/properties/${property.id}`" @click="closeStatement">
                  {{ property.referenceNumber }} — {{ property.title }} ({{ statusLabel(property.status) }})
                </router-link>
                <span v-if="!statement.financialsRestricted && property.price !== undefined">
                  {{ property.price }} {{ property.currency }}
                </span>
              </li>
            </ul>
          </section>
        </div>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" :disabled="!statement" @click="exportStatementCsv">
            <i class="fas fa-file-csv"></i> {{ store.isArabic ? 'تصدير CSV' : 'Export CSV' }}
          </button>
          <button class="btn btn-quiet no-print" type="button" :disabled="!statement" @click="onPrint">
            <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة / حفظ PDF' : 'Print / PDF' }}
          </button>
          <button class="btn btn-primary" type="button" @click="closeStatement">{{ store.isArabic ? 'إغلاق' : 'Close' }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import { useStore } from '@/stores'
import { ownerStatementCsv } from '@/utils/ownerStatementCsv'
import type { Owner, OwnerPayout, OwnerPayoutStatus, OwnerPayoutSummary, OwnerPortalLink, OwnerStatement } from '@/types'

const store = useStore()
const printGeneratedAt = computed(() => new Date().toLocaleString(store.isArabic ? 'ar' : 'en'))
const rows = ref<Owner[]>([])
const loadingState = ref(false)
const saving = ref(false)
const formOpen = ref(false)
const detailsLoading = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const search = ref('')
const includeInactive = ref(false)
const page = ref(1)
const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 })
const selected = ref<Owner | null>(null)
const portalLink = ref<OwnerPortalLink | null>(null)
const portalBusy = ref(false)
const portalMessage = ref('')
const statementOpen = ref(false)
const statementOwner = ref<Owner | null>(null)
const statement = ref<OwnerStatement | null>(null)
const statementLoading = ref(false)
const statementError = ref('')
const payouts = ref<OwnerPayout[]>([])
const payoutSummary = ref<OwnerPayoutSummary | null>(null)
const payoutsLoading = ref(false)
const payoutSaving = ref(false)
const payoutFormOpen = ref(false)
const payoutError = ref('')
const payoutForm = reactive({ amount: '', currency: 'USD', reference: '', periodStart: '', periodEnd: '', notes: '' })

const PROPERTY_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'متاحة',
  UNDER_NEGOTIATION: 'قيد التفاوض',
  PENDING: 'قيد الانتظار',
  RESERVED: 'محجوزة',
  SOLD: 'مباعة',
  RENTED: 'مؤجرة',
  OFF_MARKET: 'خارج السوق',
  UNAVAILABLE: 'غير متاحة'
}

function statusLabel(status: string): string {
  if (store.isArabic) return PROPERTY_STATUS_LABELS[status] || status
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar' : 'en')
}

const emptyForm = () => ({
  firstName: '', lastName: '', companyName: '', email: '', phone: '', address: '', city: '', country: '', notes: '', isActive: true
})
const form = reactive(emptyForm())

onMounted(() => { void load(1) })

async function load(nextPage = 1): Promise<void> {
  loadingState.value = true
  page.value = nextPage
  try {
    const params: Record<string, string | number | boolean> = { page: nextPage, limit: 20 }
    if (search.value.trim()) params.search = search.value.trim()
    if (includeInactive.value) params.includeInactive = 'true'
    const response = await apiGet<Owner[]>('/owners', { params })
    rows.value = response.data ?? []
    if (response.pagination) pagination.value = response.pagination
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    loadingState.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
  formOpen.value = true
}

function openEdit(row: Owner): void {
  editingId.value = row.id
  Object.assign(form, {
    firstName: row.firstName || '', lastName: row.lastName || '', companyName: row.companyName || '',
    email: row.email || '', phone: row.phone || '', address: row.address || '', city: row.city || '',
    country: row.country || '', notes: row.notes || '', isActive: row.isActive
  })
  formError.value = ''
  formOpen.value = true
}

function closeForm(): void { formOpen.value = false; editingId.value = null }

async function save(): Promise<void> {
  saving.value = true
  formError.value = ''
  try {
    const payload = {
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      companyName: form.companyName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      notes: form.notes || undefined,
      isActive: form.isActive
    }
    if (editingId.value) await apiPatch(`/owners/${editingId.value}`, payload)
    else await apiPost('/owners', payload)
    closeForm()
    await load(page.value)
  } catch (e) {
    formError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function openDetails(row: Owner): Promise<void> {
  selected.value = { ...row }
  portalLink.value = null
  portalMessage.value = ''
  payouts.value = []
  payoutSummary.value = null
  payoutFormOpen.value = false
  payoutError.value = ''
  detailsLoading.value = true
  try {
    const response = await apiGet<Owner>(`/owners/${row.id}`)
    selected.value = response.data
    if (store.canManage) portalLink.value = (await apiGet<OwnerPortalLink>(`/owners/${row.id}/portal-link`)).data
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    detailsLoading.value = false
  }
  void loadPayouts(row.id)
}

async function openStatement(row: Owner): Promise<void> {
  selected.value = null
  statementOwner.value = row
  statement.value = null
  statementError.value = ''
  statementOpen.value = true
  statementLoading.value = true
  try {
    statement.value = (await apiGet<OwnerStatement>(`/owners/${row.id}/statement`)).data
  } catch (e) {
    statementError.value = errorMessage(e)
  } finally {
    statementLoading.value = false
  }
}

function closeStatement(): void {
  statementOpen.value = false
  statementOwner.value = null
  statement.value = null
}

function payoutStatusLabel(status: OwnerPayoutStatus): string {
  if (status === 'SETTLED') return store.isArabic ? 'مسدد' : 'Settled'
  if (status === 'CANCELLED') return store.isArabic ? 'ملغي' : 'Cancelled'
  return store.isArabic ? 'قيد الانتظار' : 'Pending'
}

async function loadPayouts(ownerId: string): Promise<void> {
  payoutsLoading.value = true
  payoutError.value = ''
  try {
    const response = await apiGet<OwnerPayout[]>(`/owners/${ownerId}/payouts`)
    payouts.value = response.data ?? []
    payoutSummary.value = (response as unknown as { summary?: OwnerPayoutSummary }).summary ?? null
  } catch (e) {
    payoutError.value = errorMessage(e)
    payouts.value = []
  } finally {
    payoutsLoading.value = false
  }
}

function openPayoutForm(): void {
  payoutForm.amount = ''
  payoutForm.currency = 'USD'
  payoutForm.reference = ''
  payoutForm.periodStart = ''
  payoutForm.periodEnd = ''
  payoutForm.notes = ''
  payoutError.value = ''
  payoutFormOpen.value = true
}

async function savePayout(): Promise<void> {
  if (!selected.value) return
  payoutSaving.value = true
  payoutError.value = ''
  try {
    await apiPost(`/owners/${selected.value.id}/payouts`, {
      amount: Number(payoutForm.amount),
      currency: payoutForm.currency,
      reference: payoutForm.reference || undefined,
      periodStart: payoutForm.periodStart || undefined,
      periodEnd: payoutForm.periodEnd || undefined,
      notes: payoutForm.notes || undefined
    })
    payoutFormOpen.value = false
    await loadPayouts(selected.value.id)
  } catch (e) {
    payoutError.value = errorMessage(e)
  } finally {
    payoutSaving.value = false
  }
}

async function settlePayout(payout: OwnerPayout): Promise<void> {
  if (!selected.value) return
  payoutError.value = ''
  try {
    await apiPatch(`/owners/${selected.value.id}/payouts/${payout.id}`, { status: 'SETTLED' })
    await loadPayouts(selected.value.id)
  } catch (e) {
    payoutError.value = errorMessage(e)
  }
}

function onPrint(): void {
  window.print()
}

function exportStatementCsv(): void {
  if (!statement.value) return
  const csv = ownerStatementCsv(statement.value)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `owner-statement-${statement.value.owner.id}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function writeToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const field = document.createElement('textarea')
  field.value = value
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  document.execCommand('copy')
  field.remove()
}

async function copyPortalLink(owner: Owner): Promise<void> {
  if (!store.canManage || portalBusy.value) return
  portalBusy.value = true
  try {
    const cached = selected.value?.id === owner.id ? portalLink.value : null
    const link = cached?.enabled && cached.url
      ? cached
      : (await apiPost<OwnerPortalLink>(`/owners/${owner.id}/portal-token`)).data
    if (!link.url) throw new Error(store.isArabic ? 'تعذّر إنشاء رابط البوابة.' : 'Could not create the portal link.')
    await writeToClipboard(link.url)
    portalLink.value = link
    portalMessage.value = store.isArabic ? 'تم نسخ الرابط.' : 'Link copied to clipboard.'
    await load(page.value)
  } catch (e) {
    const message = errorMessage(e)
    portalMessage.value = message
    store.error = message
  } finally {
    portalBusy.value = false
  }
}

async function regeneratePortalLink(owner: Owner): Promise<void> {
  if (!store.canManage || portalBusy.value) return
  portalBusy.value = true
  try {
    portalLink.value = (await apiPost<OwnerPortalLink>(`/owners/${owner.id}/portal-token/regenerate`)).data
    portalMessage.value = store.isArabic ? 'تم تجديد الرابط. الرابط القدي لم يعد صالحاً.' : 'Link regenerated. The previous link no longer works.'
    await load(page.value)
  } catch (e) {
    portalMessage.value = errorMessage(e)
  } finally {
    portalBusy.value = false
  }
}

async function revokePortalLink(owner: Owner): Promise<void> {
  if (!store.canManage || portalBusy.value) return
  portalBusy.value = true
  try {
    portalLink.value = (await apiPost<OwnerPortalLink>(`/owners/${owner.id}/portal-token/revoke`)).data
    portalMessage.value = store.isArabic ? 'تم إلغاء رابط البوابة.' : 'Portal link revoked.'
    await load(page.value)
  } catch (e) {
    portalMessage.value = errorMessage(e)
  } finally {
    portalBusy.value = false
  }
}

async function archiveOwner(row: Owner): Promise<void> {
  if (!window.confirm(store.isArabic ? 'أرشفة هذا المالك؟ لن تُحذف الروابط التاريخية.' : 'Archive this owner? Historical property links will be preserved.')) return
  try { await apiDeleteSafe(`/owners/${row.id}`); await load(page.value) } catch (e) { store.error = errorMessage(e) }
}

async function restoreOwner(row: Owner): Promise<void> {
  try { await apiPost(`/owners/${row.id}/restore`); await load(page.value) } catch (e) { store.error = errorMessage(e) }
}

async function apiDeleteSafe(url: string): Promise<void> {
  const { apiDelete } = await import('@/api/client')
  await apiDelete(url)
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.head-actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0; font-size: 1.15rem; }
h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.search { display: flex; gap: 0.4rem; }
.search input { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.5rem 0.7rem; min-width: 220px; }
.toggle { font-size: 0.82rem; color: #374151; display: inline-flex; gap: 0.35rem; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 8px; padding: 0.55rem 0.9rem; border: 0; font-size: 0.86rem; cursor: pointer; text-decoration: none; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.state, .empty { background: #fff; border-radius: 12px; padding: 2rem; text-align: center; color: #6b7280; }
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
th, td { text-align: start; padding: 0.7rem 0.9rem; border-bottom: 1px solid #f3f4f6; }
th { background: #f9fafb; font-size: 0.74rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
.actions-col { text-align: end; white-space: nowrap; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.82rem; margin-inline-start: 0.5rem; }
.link.danger { color: #dc2626; }
.tag { font-size: 0.72rem; padding: 0.2rem 0.55rem; border-radius: 999px; }
.tag.active { background: #dcfce7; color: #166534; }
.tag.inactive { background: #f3f4f6; color: #6b7280; }
.overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: grid; place-items: center; padding: 1rem; z-index: 30; }
.modal { background: #fff; border-radius: 14px; width: min(100%, 760px); max-height: 90vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.2rem; border-bottom: 1px solid #eef2f7; }
.modal-head button { background: none; border: 0; font-size: 1.4rem; cursor: pointer; }
.modal-body { padding: 1.2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.8rem; }
.modal-body.details { grid-template-columns: 1fr 1fr; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
label.checkbox { flex-direction: row; align-items: center; gap: 0.5rem; }
label.full, .full { grid-column: 1 / -1; }
input, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.88rem; font-family: inherit; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.84rem; }
.modal-actions { display: flex; gap: 0.6rem; padding: 1rem 1.2rem; border-top: 1px solid #eef2f7; }
.pager { display: flex; justify-content: center; align-items: center; gap: 0.8rem; }
.pager button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 0.3rem 0.8rem; cursor: pointer; }
.prop-list { margin: 0; padding-inline-start: 1.2rem; display: flex; flex-direction: column; gap: 0.35rem; }
.prop-list a { color: #4f46e5; text-decoration: none; }
.portal-panel { border: 1px solid #e0e7ff; border-radius: 10px; padding: 0.8rem; background: #f8faff; display: flex; flex-direction: column; gap: 0.5rem; }
.portal-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.payouts { border-top: 1px solid #eef2f7; padding-top: 0.9rem; }
.payout-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.payout-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; background: #f9fafb; border-radius: 10px; padding: 0.8rem; margin: 0.7rem 0; }
.payout-actions { display: flex; gap: 0.6rem; }
.payout-list { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.payout-list li { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; font-size: 0.84rem; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.4rem; }
.payout-list time { margin-inline-start: auto; color: #6b7280; font-size: 0.72rem; }
.tag.pending { background: #fef3c7; color: #92400e; }
.tag.settled { background: #dcfce7; color: #166534; }
.tag.cancelled { background: #f3f4f6; color: #6b7280; }
.statement-modal { width: min(100%, 880px); }
.statement-subtitle { padding: 0.8rem 1.2rem 0; }
.statement-body { display: flex; flex-direction: column; gap: 1.1rem; }
.summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
.summary-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.15rem; }
.summary-card span { color: #6b7280; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; }
.summary-card strong { font-size: 1.35rem; color: #4338ca; }
.summary-card small { color: #6b7280; font-size: 0.72rem; }
.statement-section h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
.statement-table { border: 1px solid #e5e7eb; border-radius: 10px; }
.statement-table th { white-space: nowrap; }
.statement-table td { white-space: nowrap; }
.notice { background: #fffbeb; color: #92400e; border-radius: 8px; padding: 0.6rem 0.75rem; font-size: 0.82rem; margin: 0; }
.inline-error { margin: 1rem 1.2rem; }
.prop-list li { display: flex; justify-content: space-between; gap: 0.75rem; }
@media (max-width: 768px) {
  .table-wrap { overflow-x: auto; }
  .btn, .modal-actions button, .search input { min-height: 44px; }
  .modal { width: 100%; border-radius: 10px; }
  .modal-head, .modal-body, .modal-actions { padding-inline: 0.75rem; }
}
@media (max-width: 768px) {
  .modal { padding: 0.5rem; }
  .table-wrap, .statement-table { overflow-x: auto; }
  .btn, .link, input, textarea { min-height: 44px; }
  .head-actions { justify-content: flex-start; }
}
@media (max-width: 640px) { .modal-body.details { grid-template-columns: 1fr; } .search input { min-width: 140px; } .summary-cards { grid-template-columns: 1fr; } }
</style>