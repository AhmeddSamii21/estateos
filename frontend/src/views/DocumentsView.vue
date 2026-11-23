<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'الوثائق' : 'Documents' }}</h1>
        <p class="muted">{{ rows.length }} {{ store.isArabic ? 'وثيقة' : 'documents' }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="formOpen = !formOpen">
        <i class="fas fa-upload"></i> {{ store.isArabic ? 'رفع وثيقة' : 'Upload document' }}
      </button>
    </div>

    <form v-if="formOpen" class="panel upload-form" @submit.prevent="onUpload">
      <h2>{{ store.isArabic ? 'وثيقة جديدة' : 'New document' }}</h2>
      <div class="form-grid">
        <label>
          <span>{{ store.isArabic ? 'الملف *' : 'File *' }}</span>
          <input type="file" :accept="acceptedTypes" required @change="onFileChange" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الاسم' : 'Name' }}</span>
          <input v-model="upload.name" maxlength="200" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الفئة' : 'Category' }}</span>
          <select v-model="upload.category">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'العقار' : 'Property ID' }}</span>
          <input v-model="upload.propertyId" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الصفقة' : 'Deal ID' }}</span>
          <input v-model="upload.dealId" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'العميل' : 'Lead ID' }}</span>
          <input v-model="upload.leadId" />
        </label>
        <label class="full">
          <span>{{ store.isArabic ? 'الوصف' : 'Description' }}</span>
          <textarea v-model="upload.description" rows="2"></textarea>
        </label>
      </div>
      <div v-if="formError" class="error" role="alert">{{ formError }}</div>
      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="saving || !selectedFile">
          {{ saving ? '…' : (store.isArabic ? 'رفع' : 'Upload') }}
        </button>
        <button class="btn btn-quiet" type="button" @click="closeForm">{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</button>
      </div>
    </form>

    <div class="filters">
      <label>
        <span>{{ store.isArabic ? 'بحث' : 'Search' }}</span>
        <input v-model="filters.search" type="search" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الفئة' : 'Category' }}</span>
        <select v-model="filters.category">
          <option value="">{{ store.isArabic ? 'الكل' : 'All' }}</option>
          <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
        <select v-model="filters.status">
          <option value="ALL">{{ store.isArabic ? 'الكل' : 'All' }}</option>
          <option value="ACTIVE">{{ store.isArabic ? 'نشط' : 'Active' }}</option>
          <option value="ARCHIVED">{{ store.isArabic ? 'مؤرشف' : 'Archived' }}</option>
        </select>
      </label>
      <button class="btn btn-quiet" type="button" @click="load">{{ store.isArabic ? 'تحديث' : 'Refresh' }}</button>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!rows.length" class="state">{{ store.isArabic ? 'لا توجد وثائق.' : 'No documents found.' }}</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
            <th>{{ store.isArabic ? 'الفئة' : 'Category' }}</th>
            <th>{{ store.isArabic ? 'الارتباط' : 'Linked to' }}</th>
            <th>{{ store.isArabic ? 'الحجم' : 'Size' }}</th>
            <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
            <th>{{ store.isArabic ? 'إجراءات' : 'Actions' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="document in rows" :key="document.id">
            <td>
              <strong>{{ document.name }}</strong>
              <small>{{ document.originalName }}</small>
            </td>
            <td>{{ document.category }}</td>
            <td>{{ linkLabel(document) }}</td>
            <td>{{ formatSize(document.size) }}</td>
            <td><span class="tag">{{ document.status }}</span></td>
            <td class="actions-col">
              <button type="button" class="link" :disabled="document.status === 'ARCHIVED'" @click="onDownload(document)">
                {{ store.isArabic ? 'تنزيل' : 'Download' }}
              </button>
              <button
                v-if="document.status === 'ARCHIVED'"
                type="button"
                class="link"
                @click="restore(document)"
              >{{ store.isArabic ? 'استعادة' : 'Restore' }}</button>
              <button v-else type="button" class="link danger" @click="archive(document)">
                {{ store.isArabic ? 'أرشفة' : 'Archive' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import { downloadDocument } from '@/utils/documents'
import { useStore } from '@/stores'
import type { DocumentRecord } from '@/types'

const store = useStore()
const rows = ref<DocumentRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const formOpen = ref(false)
const formError = ref('')
const selectedFile = ref<File | null>(null)

const categories = ['CONTRACT', 'DEED', 'INVOICE', 'RECEIPT', 'IDENTITY', 'INSPECTION', 'PHOTO', 'OTHER']
const acceptedTypes = '.pdf,.jpg,.jpeg,.png,.txt,.csv,.docx,.xlsx'

const filters = reactive({ search: '', category: '', status: 'ALL' })
const upload = reactive({
  name: '',
  category: 'OTHER',
  propertyId: '',
  dealId: '',
  leadId: '',
  description: ''
})

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (filters.search) params.search = filters.search
    if (filters.category) params.category = filters.category
    if (filters.status) params.status = filters.status
    const response = await apiGet<DocumentRecord[]>('/documents', { params })
    rows.value = response.data ?? []
  } catch (error) {
    store.error = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
}

function closeForm(): void {
  formOpen.value = false
  formError.value = ''
  selectedFile.value = null
  upload.name = ''
  upload.category = 'OTHER'
  upload.propertyId = ''
  upload.dealId = ''
  upload.leadId = ''
  upload.description = ''
}

async function onUpload(): Promise<void> {
  if (!selectedFile.value) return
  if (selectedFile.value.size > 10 * 1024 * 1024) {
    formError.value = store.isArabic ? 'الحد الأقصى للحجم 10 ميجابايت.' : 'The file must be 10 MB or smaller.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const data = new FormData()
    data.append('file', selectedFile.value)
    data.append('category', upload.category)
    if (upload.name) data.append('name', upload.name)
    if (upload.propertyId) data.append('propertyId', upload.propertyId)
    if (upload.dealId) data.append('dealId', upload.dealId)
    if (upload.leadId) data.append('leadId', upload.leadId)
    if (upload.description) data.append('description', upload.description)
    await apiPost('/documents', data)
    closeForm()
    await load()
  } catch (error) {
    formError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function onDownload(document: DocumentRecord): Promise<void> {
  try {
    await downloadDocument(document.id, document.originalName)
  } catch (error) {
    store.error = errorMessage(error)
  }
}

async function archive(document: DocumentRecord): Promise<void> {
  if (!window.confirm(store.isArabic ? 'أرشفة هذه الوثيقة؟' : 'Archive this document?')) return
  try {
    await apiDelete(`/documents/${document.id}`)
    await load()
  } catch (error) {
    store.error = errorMessage(error)
  }
}

async function restore(document: DocumentRecord): Promise<void> {
  try {
    await apiPatch(`/documents/${document.id}`, { status: 'ACTIVE' })
    await load()
  } catch (error) {
    store.error = errorMessage(error)
  }
}

function linkLabel(document: DocumentRecord): string {
  return document.property?.title || document.deal?.referenceNumber || document.propertyId || document.dealId || document.leadId || '—'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 0.9rem; font-size: 1.05rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-size: 0.86rem; cursor: pointer; text-decoration: none; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.2rem; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #374151; }
label.full { grid-column: 1 / -1; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; font-family: inherit; }
.actions { display: flex; gap: 0.6rem; margin-top: 1rem; }
.filters { display: flex; gap: 0.8rem; align-items: end; flex-wrap: wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.9rem 1.1rem; }
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: start; padding: 0.65rem 0.8rem; border-bottom: 1px solid #f3f4f6; }
th { background: #f9fafb; font-size: 0.72rem; color: #6b7280; text-transform: uppercase; }
td small { display: block; color: #9ca3af; font-size: 0.7rem; }
.tag { font-size: 0.68rem; background: #e0e7ff; color: #3730a3; padding: 0.2rem 0.5rem; border-radius: 999px; }
.actions-col { text-align: end; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.82rem; margin-inline-start: 0.4rem; }
.link.danger { color: #dc2626; }
.state { background: #fff; border-radius: 12px; padding: 3rem; text-align: center; color: #6b7280; }
.error { grid-column: 1 / -1; background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem; font-size: 0.84rem; }
</style>
