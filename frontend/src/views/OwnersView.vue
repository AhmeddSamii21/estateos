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
      <button type="button" :disabled="page <= 1" @click="load(page - 1)">‹</button>
      <span>{{ page }} / {{ pagination.pages }}</span>
      <button type="button" :disabled="page >= pagination.pages" @click="load(page + 1)">›</button>
    </div>

    <div v-if="formOpen" class="overlay" @click.self="closeForm">
      <form class="modal" @submit.prevent="save">
        <div class="modal-head">
          <h2>{{ editingId ? (store.isArabic ? 'تعديل مالك' : 'Edit owner') : (store.isArabic ? 'مالك جديد' : 'New owner') }}</h2>
          <button type="button" aria-label="Close" @click="closeForm">×</button>
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
          <button type="button" aria-label="Close" @click="selected = null">×</button>
        </div>
        <div class="modal-body details">
          <p><strong>{{ store.isArabic ? 'البريد' : 'Email' }}:</strong> {{ selected.email || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الهاتف' : 'Phone' }}:</strong> {{ selected.phone || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الموقع' : 'Location' }}:</strong> {{ [selected.address, selected.city, selected.country].filter(Boolean).join(', ') || '—' }}</p>
          <p><strong>{{ store.isArabic ? 'الحالة' : 'Status' }}:</strong> {{ selected.isActive ? (store.isArabic ? 'نشط' : 'Active') : (store.isArabic ? 'مؤرشف' : 'Archived') }}</p>
          <p v-if="selected.notes"><strong>{{ store.isArabic ? 'ملاحظات' : 'Notes' }}:</strong> {{ selected.notes }}</p>
          <div class="full">
            <h3>{{ store.isArabic ? 'العقارات المرتبطة' : 'Associated properties' }}</h3>
            <div v-if="detailsLoading" class="empty">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
            <div v-else-if="!selected.properties?.length" class="empty">{{ store.isArabic ? 'لا توجد عقارات مرتبطة.' : 'No associated properties.' }}</div>
            <ul v-else class="prop-list">
              <li v-for="property in selected.properties" :key="property.id">
                <router-link :to="`/properties/${property.id}`" @click="selected = null">
                  {{ property.referenceNumber }} — {{ property.title }} ({{ property.status }})
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
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import { useStore } from '@/stores'
import type { Owner } from '@/types'

const store = useStore()
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
  detailsLoading.value = true
  try {
    const response = await apiGet<Owner>(`/owners/${row.id}`)
    selected.value = response.data
  } catch (e) {
    store.error = errorMessage(e)
  } finally {
    detailsLoading.value = false
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
@media (max-width: 640px) { .modal-body.details { grid-template-columns: 1fr; } .search input { min-width: 140px; } }
</style>