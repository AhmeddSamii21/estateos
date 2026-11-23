<template>
  <div class="page">
    <h1>{{ isEdit ? (store.isArabic ? 'تعديل عقار' : 'Edit property') : (store.isArabic ? 'عقار جديد' : 'New property') }}</h1>

    <div v-if="loadingRecord" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>

    <form v-else class="card" @submit.prevent="onSubmit">
      <div class="grid">
        <label>
          <span>{{ store.isArabic ? 'العنوان *' : 'Title *' }}</span>
          <input v-model="form.title" required maxlength="200" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الرقم المرجعي' : 'Reference number' }}</span>
          <input v-model="form.referenceNumber" :disabled="isEdit" />
          <small>{{ store.isArabic ? 'يُنشأ تلقائيًا إذا تُرك فارغًا' : 'Generated automatically when blank' }}</small>
        </label>
        <label>
          <span>{{ store.isArabic ? 'النوع *' : 'Type *' }}</span>
          <select v-model="form.type" required>
            <option v-for="option in types" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
          <select v-model="form.status">
            <option v-for="option in statuses" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'السعر *' : 'Price *' }}</span>
          <input v-model="form.price" type="number" min="0" step="0.01" required />
        </label>
        <label>
          <span>{{ store.isArabic ? 'العملة' : 'Currency' }}</span>
          <input v-model="form.currency" maxlength="3" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'المدينة' : 'City' }}</span>
          <input v-model="form.city" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'العنوان' : 'Address' }}</span>
          <input v-model="form.address" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</span>
          <input v-model="form.bedrooms" type="number" min="0" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الحمامات' : 'Bathrooms' }}</span>
          <input v-model="form.bathrooms" type="number" min="0" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'المساحة' : 'Area' }}</span>
          <input v-model="form.area" type="number" min="0" step="0.01" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'سنة البناء' : 'Year built' }}</span>
          <input v-model="form.yearBuilt" type="number" min="1800" max="2100" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'المالك' : 'Owner' }}</span>
          <select v-model="form.ownerId">
            <option value="">{{ store.isArabic ? 'بدون مالك' : 'No owner' }}</option>
            <option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ ownerLabel(owner) }}</option>
          </select>
        </label>
      </div>
      <label class="full">
        <span>{{ store.isArabic ? 'الوصف' : 'Description' }}</span>
        <textarea v-model="form.description" rows="3"></textarea>
      </label>

      <div v-if="formError" class="error" role="alert">{{ formError }}</div>

      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="store.loading">
          {{ store.loading ? '…' : (store.isArabic ? 'حفظ' : 'Save') }}
        </button>
        <router-link class="btn btn-quiet" to="/properties">{{ store.isArabic ? 'إلغاء' : 'Cancel' }}</router-link>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet } from '@/api/client'
import { useStore } from '@/stores'
import type { Owner } from '@/types'

const props = defineProps<{ id?: string }>()
const store = useStore()
const route = useRoute()
const router = useRouter()
const loadingRecord = ref(false)
const formError = ref('')
const owners = ref<Owner[]>([])

const recordId = computed(() => props.id || String(route.params.id || ''))
const isEdit = computed(() => Boolean(recordId.value))

const types = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'VILLA', 'LAND', 'COMMERCIAL']
const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE']

const form = reactive({
  title: '',
  referenceNumber: '',
  type: 'HOUSE',
  status: 'AVAILABLE',
  price: '',
  currency: 'USD',
  city: '',
  address: '',
  bedrooms: '0',
  bathrooms: '0',
  area: '',
  yearBuilt: '',
  description: '',
  ownerId: ''
})

onMounted(async () => {
  void loadOwners()
  if (!isEdit.value) return
  loadingRecord.value = true
  const property = await store.fetchProperty(recordId.value)
  if (property) {
    Object.assign(form, {
      title: property.title,
      referenceNumber: property.referenceNumber,
      type: property.type,
      status: property.status,
      price: String(property.price),
      currency: property.currency,
      city: property.city || '',
      address: property.address || '',
      bedrooms: String(property.bedrooms),
      bathrooms: String(property.bathrooms),
      area: property.area == null ? '' : String(property.area),
      yearBuilt: property.yearBuilt == null ? '' : String(property.yearBuilt),
      description: property.description || '',
      ownerId: property.ownerId || ''
    })
  }
  loadingRecord.value = false
})

async function loadOwners(): Promise<void> {
  try {
    const response = await apiGet<Owner[]>('/owners', { params: { limit: 100 } })
    owners.value = response.data ?? []
  } catch {
    owners.value = []
  }
}

function ownerLabel(owner: Owner): string {
  const company = owner.companyName?.trim()
  const person = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim()
  return owner.displayName || company || person || owner.email || owner.id
}

function payload(): Record<string, unknown> {
  return {
    title: form.title.trim(),
    ...(form.referenceNumber && !isEdit.value ? { referenceNumber: form.referenceNumber.trim() } : {}),
    type: form.type,
    status: form.status,
    price: Number(form.price),
    currency: form.currency.trim() || 'USD',
    city: form.city.trim() || undefined,
    address: form.address.trim() || undefined,
    bedrooms: Number(form.bedrooms || 0),
    bathrooms: Number(form.bathrooms || 0),
    area: form.area ? Number(form.area) : undefined,
    yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : undefined,
    description: form.description.trim() || undefined,
    ownerId: form.ownerId || ''
  }
}

async function onSubmit(): Promise<void> {
  formError.value = ''
  if (!form.title.trim() || Number(form.price) < 0) {
    formError.value = store.isArabic ? 'يرجى إدخال العنوان وسعر صحيح.' : 'Please provide a title and a valid price.'
    return
  }
  try {
    const saved = isEdit.value
      ? await store.updateProperty(recordId.value, payload())
      : await store.createProperty(payload())
    if (saved) await router.push(`/properties/${saved.id}`)
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Save failed.'
  }
}
</script>

<style scoped>
.page { max-width: 860px; }
h1 { font-size: 1.4rem; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.9rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #374151; }
label.full { margin-top: 0.9rem; }
small { color: #9ca3af; font-size: 0.7rem; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.55rem 0.65rem; font-size: 0.9rem; font-family: inherit; }
.actions { display: flex; gap: 0.6rem; margin-top: 1.2rem; }
.btn { display: inline-flex; align-items: center; border-radius: 8px; padding: 0.6rem 1rem; text-decoration: none; font-size: 0.88rem; }
.btn-primary { background: #4f46e5; color: #fff; border: 0; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.error { margin-top: 1rem; padding: 0.6rem 0.8rem; background: #fef2f2; color: #991b1b; border-radius: 8px; font-size: 0.85rem; }
.state { padding: 2rem; text-align: center; color: #6b7280; }
</style>
