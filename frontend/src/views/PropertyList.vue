<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'العقارات' : 'Properties' }}</h1>
        <p class="muted">{{ store.pagination.total }} {{ store.isArabic ? 'عقار مسجل' : 'properties recorded' }}</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-quiet" type="button" :disabled="exportBusy" @click="onExportProperties">
          <i class="fas fa-file-csv"></i> {{ exportBusy ? '…' : (store.isArabic ? 'تصدير CSV' : 'Export CSV') }}
        </button>
        <button v-if="store.canManage" class="btn btn-quiet" type="button" @click="selectionMode = !selectionMode">
          <i class="fas fa-list-check"></i> {{ selectionMode ? (store.isArabic ? 'إنهاء التحديد' : 'Exit selection') : (store.isArabic ? 'عمليات جماعية' : 'Bulk actions') }}
        </button>
        <router-link class="btn btn-primary" to="/properties/new">
          <i class="fas fa-plus"></i> {{ store.isArabic ? 'إضافة عقار' : 'Add property' }}
        </router-link>
      </div>
    </div>

    <section v-if="store.canManage && selectionMode" class="bulk-panel">
      <div class="bulk-row">
        <label class="check-all"><input type="checkbox" :checked="allSelected" @change="toggleSelectAll" /> {{ store.isArabic ? 'تحديد الكل' : 'Select all' }} ({{ selectedIds.length }})</label>
        <select v-model="bulkAction">
          <option value="">{{ store.isArabic ? 'اختر عملية' : 'Choose action' }}</option>
          <option value="archive">{{ store.isArabic ? 'أرشفة' : 'Archive' }}</option>
          <option value="restore">{{ store.isArabic ? 'استعادة' : 'Restore' }}</option>
          <option value="status">{{ store.isArabic ? 'تغيير الحالة' : 'Change status' }}</option>
          <option value="assign">{{ store.isArabic ? 'تعيين وكيل' : 'Assign agent' }}</option>
        </select>
        <select v-if="bulkAction === 'status'" v-model="bulkStatus">
          <option value="">{{ store.isArabic ? 'اختر الحالة' : 'Select status' }}</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
        <select v-if="bulkAction === 'assign'" v-model="bulkAgentId">
          <option value="">{{ store.isArabic ? 'بدون وكيل' : 'Unassigned' }}</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.firstName || agent.email }} ({{ agent.role }})</option>
        </select>
        <button class="btn btn-primary" type="button" :disabled="bulkBusy || !canRunBulk" @click="runBulk">
          {{ bulkBusy ? '…' : (store.isArabic ? 'تنفيذ' : 'Run') }}
        </button>
      </div>
      <p class="muted small">{{ store.isArabic ? 'لن يتم حذف أي عقار. العمليات المدعومة: الأرشفة، الاستعادة، تغيير حالة صالح، أو التعيين.' : 'No properties will be deleted. Supported: archive, restore, valid status change, or assignment.' }}</p>
      <div v-if="bulkMessage" class="notice">{{ bulkMessage }}</div>
      <ul v-if="bulkResults.length" class="bulk-results">
        <li v-for="result in bulkResults" :key="result.id" :class="result.success ? 'ok' : 'fail'">
          <strong>{{ propertyRef(result.id) }}</strong>: {{ result.message }}
        </li>
      </ul>
    </section>

    <PropertyFilters :initial="store.activeFilters" @apply="onApply" @clear="onClear" />

    <div v-if="exportError" class="error" role="alert">{{ exportError }}</div>

    <div v-if="store.loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!store.properties.length" class="state">
      {{ store.isArabic ? 'لا توجد عقارات مطابقة للفلاتر الحالية.' : 'No properties match the current filters.' }}
    </div>
    <div v-else class="grid">
      <div v-for="property in store.properties" :key="property.id" class="grid-item">
        <label v-if="store.canManage && selectionMode" class="select-box" @click.stop>
          <input type="checkbox" :checked="selectedIds.includes(property.id)" @change="toggleSelected(property.id)" />
          <span>{{ store.isArabic ? 'تحديد' : 'Select' }}</span>
        </label>
        <PropertyItem :property="property" @select="open" />
      </div>
    </div>

    <div v-if="store.pagination.pages > 1" class="pager">
      <button type="button" :disabled="page <= 1" @click="go(page - 1)">‹</button>
      <span>{{ page }} / {{ store.pagination.pages }}</span>
      <button type="button" :disabled="page >= store.pagination.pages" @click="go(page + 1)">›</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost, errorMessage } from '@/api/client'
import PropertyFilters from '@/components/PropertyFilters.vue'
import PropertyItem from '@/components/PropertyItem.vue'
import { downloadCsv, type CsvColumn, type CsvRow } from '@/utils/csv'
import { useStore } from '@/stores'
import type { Property, PropertyFilters as Filters } from '@/types'

const store = useStore()
const router = useRouter()
const page = ref(1)
const selectionMode = ref(false)
const selectedIds = ref<string[]>([])
const bulkAction = ref('')
const bulkStatus = ref('')
const bulkAgentId = ref('')
const bulkBusy = ref(false)
const bulkMessage = ref('')
const bulkResults = ref<Array<{ id: string; success: boolean; message: string }>>([])
const exportBusy = ref(false)
const exportError = ref('')
const agents = ref<Array<{ id: string; email: string; firstName?: string | null; role: string }>>([])
const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE']

onMounted(() => {
  if (!store.allProperties.length) void store.fetchProperties({ page: 1, limit: 20 })
  if (store.canManage) void loadAgents()
})

watch(() => store.canManage, (value) => { if (value) void loadAgents() })

const allSelected = computed(() => store.properties.length > 0 && selectedIds.value.length === store.properties.length)
const canRunBulk = computed(() => {
  if (!selectedIds.value.length || !bulkAction.value) return false
  if (bulkAction.value === 'status') return Boolean(bulkStatus.value)
  return true
})

async function loadAgents(): Promise<void> {
  try {
    const response = await apiGet<Array<{ id: string; email: string; firstName?: string | null; role: string }>>('/users', { params: { limit: 100 } })
    agents.value = (response.data ?? []).filter((user) => ['ADMIN', 'MANAGER', 'AGENT'].includes(user.role))
  } catch {
    agents.value = []
  }
}

function toggleSelected(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id]
}

function toggleSelectAll(): void {
  selectedIds.value = allSelected.value ? [] : store.properties.map((property) => property.id)
}

function propertyRef(id: string): string {
  const property = store.properties.find((item) => item.id === id)
  return property?.referenceNumber || property?.title || id
}

async function runBulk(): Promise<void> {
  if (!canRunBulk.value) return
  bulkBusy.value = true
  bulkMessage.value = ''
  bulkResults.value = []
  try {
    const payload: Record<string, unknown> = { action: bulkAction.value, ids: selectedIds.value }
    if (bulkAction.value === 'status') payload.status = bulkStatus.value
    if (bulkAction.value === 'assign') payload.assignedAgentId = bulkAgentId.value || null
    const response = await apiPost<{ action: string; total: number; succeeded: number; failed: number; results: Array<{ id: string; success: boolean; message: string }> }>('/properties/bulk', payload)
    const data = response.data
    bulkMessage.value = response.message || `${data?.succeeded ?? 0}/${data?.total ?? 0} succeeded`
    bulkResults.value = data?.results ?? []
    selectedIds.value = []
    await store.fetchProperties({ ...store.activeFilters, page: page.value, limit: 20 })
  } catch (error) {
    bulkMessage.value = errorMessage(error)
  } finally {
    bulkBusy.value = false
  }
}

async function onExportProperties(): Promise<void> {
  if (exportBusy.value) return
  exportBusy.value = true
  exportError.value = ''
  try {
    const t = (english: string, arabic: string) => store.isArabic ? arabic : english
    const columns: CsvColumn[] = [
      { key: 'referenceNumber', label: t('Reference', 'الرقم المرجعي') },
      { key: 'title', label: t('Title', 'العنوان') },
      { key: 'type', label: t('Type', 'النوع') },
      { key: 'classification', label: t('Classification', 'التصنيف') },
      { key: 'status', label: t('Status', 'الحالة') },
      { key: 'address', label: t('Address', 'العنوان') },
      { key: 'city', label: t('City', 'المدينة') },
      { key: 'country', label: t('Country', 'الدولة') },
      { key: 'price', label: t('Price', 'السعر') },
      { key: 'currency', label: t('Currency', 'العملة') },
      { key: 'bedrooms', label: t('Bedrooms', 'غرف النوم') },
      { key: 'bathrooms', label: t('Bathrooms', 'الحمامات') },
      { key: 'area', label: t('Area', 'المساحة') },
      { key: 'areaUnit', label: t('Area unit', 'وحدة المساحة') },
      { key: 'yearBuilt', label: t('Year built', 'سنة البناء') },
      { key: 'condition', label: t('Condition', 'الحالة العامة') },
      { key: 'occupancyStatus', label: t('Occupancy', 'الإشغال') },
      { key: 'availableFrom', label: t('Available from', 'متاح من') },
      { key: 'latitude', label: t('Latitude', 'خط العرض') },
      { key: 'longitude', label: t('Longitude', 'خط الطول') }
    ]

    const rows: CsvRow[] = []
    let currentPage = 1
    let totalPages = 1
    do {
      const response = await apiGet<Property[]>('/properties', {
        params: { ...store.activeFilters, page: currentPage, limit: 100 }
      })
      const batch = response.data ?? []
      rows.push(...batch.map((property) => ({
        referenceNumber: property.referenceNumber,
        title: property.title,
        type: property.type,
        classification: property.classification,
        status: property.status,
        address: property.address ?? '',
        city: property.city ?? '',
        country: property.country ?? '',
        price: property.price == null ? '' : Number(property.price).toFixed(2),
        currency: property.currency,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        area: property.area ?? '',
        areaUnit: property.areaUnit,
        yearBuilt: property.yearBuilt ?? '',
        condition: property.condition,
        occupancyStatus: property.occupancyStatus ?? '',
        availableFrom: property.availableFrom ? String(property.availableFrom).slice(0, 10) : '',
        latitude: property.latitude ?? '',
        longitude: property.longitude ?? ''
      })))
      totalPages = response.pagination?.pages ?? 1
      currentPage += 1
    } while (currentPage <= totalPages)

    if (!rows.length) {
      exportError.value = t('No properties match the current filters.', 'لا توجد عقارات مطابقة للفلاتر الحالية.')
      return
    }
    downloadCsv(`properties-export-${new Date().toISOString().slice(0, 10)}`, columns, rows)
  } catch (error) {
    exportError.value = errorMessage(error)
  } finally {
    exportBusy.value = false
  }
}

function onApply(filters: Filters): void {
  page.value = 1
  void store.fetchProperties({ ...filters, page: 1, limit: 20 })
}

function onClear(): void {
  page.value = 1
  store.clearFilters()
  void store.fetchProperties({ page: 1, limit: 20 })
}

function go(next: number): void {
  page.value = next
  void store.fetchProperties({ ...store.activeFilters, page: next, limit: 20 })
}

function open(property: Property): void {
  void router.push(`/properties/${property.id}`)
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.head-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.muted.small { margin: 0; font-size: 0.78rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 0.6rem 1rem; text-decoration: none; font-size: 0.88rem; cursor: pointer; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.grid-item { display: flex; flex-direction: column; gap: 0.4rem; }
.select-box { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; color: #374151; padding-inline-start: 0.2rem; }
.state { text-align: center; padding: 3rem; color: #6b7280; background: #fff; border-radius: 12px; }
.pager { display: flex; justify-content: center; align-items: center; gap: 0.8rem; }
.pager button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 0.3rem 0.8rem; cursor: pointer; }
.pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.bulk-panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.7rem; }
.bulk-row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
.bulk-row select { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.5rem 0.6rem; font-size: 0.86rem; }
.check-all { font-size: 0.84rem; color: #374151; display: inline-flex; gap: 0.35rem; align-items: center; }
.notice { background: #eef2ff; color: #3730a3; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.84rem; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.84rem; }
.bulk-results { margin: 0; padding-inline-start: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.82rem; max-height: 180px; overflow: auto; }
.bulk-results li.ok { color: #166534; }
.bulk-results li.fail { color: #991b1b; }
@media (max-width: 640px) { .bulk-row { flex-direction: column; align-items: stretch; } .bulk-row .btn { justify-content: center; } }
</style>
