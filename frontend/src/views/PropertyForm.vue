<template>
  <div class="page">
    <h1>{{ isEdit ? (store.isArabic ? 'تعديل عقار' : 'Edit property') : (store.isArabic ? 'عقار جديد' : 'New property') }}</h1>

    <div v-if="loadingRecord" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>

    <div v-if="duplicatePrefill" class="notice">
      {{ store.isArabic ? 'تم تعبئة البيانات من العقار الأصلي. راجع العنوان والسعر قبل الحفظ.' : 'Prefilled from the source property. Review the title and price before saving.' }}
    </div>

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
          <span>{{ store.isArabic ? 'التصنيف' : 'Classification' }}</span>
          <select v-model="form.classification">
            <option v-for="option in classifications" :key="option" :value="option">{{ option }}</option>
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
          <span>{{ store.isArabic ? 'المنطقة / الولاية' : 'State' }}</span>
          <input v-model="form.state" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الدولة' : 'Country' }}</span>
          <input v-model="form.country" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الرمز البريدي' : 'Postal code' }}</span>
          <input v-model="form.postalCode" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'خط العرض' : 'Latitude' }}</span>
          <input v-model="form.latitude" type="number" step="any" min="-90" max="90" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'خط الطول' : 'Longitude' }}</span>
          <input v-model="form.longitude" type="number" step="any" min="-180" max="180" />
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
          <span>{{ store.isArabic ? 'الطوابق' : 'Floors' }}</span>
          <input v-model="form.floors" type="number" min="0" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'وحدة المساحة' : 'Area unit' }}</span>
          <select v-model="form.areaUnit">
            <option v-for="option in areaUnits" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'الحالة العامة' : 'Condition' }}</span>
          <select v-model="form.condition">
            <option v-for="option in conditions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'الإشغال' : 'Occupancy' }}</span>
          <select v-model="form.occupancyStatus">
            <option value="">{{ store.isArabic ? 'غير محدد' : 'Unspecified' }}</option>
            <option v-for="option in occupancyStatuses" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="checkbox">
          <input v-model="form.negotiable" type="checkbox" />
          <span>{{ store.isArabic ? 'قابل للتفاوض' : 'Negotiable' }}</span>
        </label>
        <label>
          <span>{{ store.isArabic ? 'المالك' : 'Owner' }}</span>
          <select v-model="form.ownerId">
            <option value="">{{ store.isArabic ? 'بدون مالك' : 'No owner' }}</option>
            <option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ ownerLabel(owner) }}</option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'معرّف الفرع' : 'Branch ID' }}</span>
          <input v-model="form.branchId" maxlength="100" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'معرّف الفريق' : 'Team ID' }}</span>
          <input v-model="form.teamId" maxlength="100" />
        </label>
      </div>
      <label class="full">
        <span>{{ store.isArabic ? 'الوصف' : 'Description' }}</span>
        <textarea v-model="form.description" rows="3"></textarea>
      </label>
      <label class="full">
        <span>{{ store.isArabic ? 'المميزات (إنجليزي / عربي)' : 'Features (EN / AR)' }}</span>
        <textarea v-model="form.features" rows="2" maxlength="2000"></textarea>
      </label>
      <label class="full">
        <span>{{ store.isArabic ? 'شروط الدفع (إنجليزي / عربي)' : 'Payment terms (EN / AR)' }}</span>
        <textarea v-model="form.paymentTerms" rows="2" maxlength="2000"></textarea>
      </label>

      <section v-if="isEdit" class="gallery-panel">
        <div class="gallery-heading">
          <h2>{{ store.isArabic ? 'معرض الصور' : 'Image gallery' }}</h2>
          <label class="btn btn-quiet upload-btn">
            <i class="fas fa-upload"></i> {{ store.isArabic ? 'رفع صور' : 'Upload images' }}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onGalleryUpload" />
          </label>
        </div>
        <p class="gallery-hint">{{ store.isArabic ? 'JPG أو PNG أو WebP، حتى 5 ميجابايت للصورة.' : 'JPG, PNG or WebP, up to 5 MB per image.' }}</p>
        <div v-if="galleryError" class="error" role="alert">{{ galleryError }}</div>
        <div v-if="galleryBusy" class="state">{{ store.isArabic ? 'جارٍ تحديث الصور…' : 'Updating images…' }}</div>
        <div v-else-if="!galleryImages.length" class="state">{{ store.isArabic ? 'لا توجد صور لهذا العقار.' : 'No images for this property yet.' }}</div>
        <div v-else class="gallery-grid">
          <figure v-for="(image, index) in galleryImages" :key="image.id" class="gallery-item">
            <img v-if="imageObjectUrls[image.id]" :src="imageObjectUrls[image.id]" :alt="image.originalName || form.title" loading="lazy" />
            <div v-else class="image-placeholder"><i class="fas fa-image"></i></div>
            <figcaption>
              <span v-if="image.isPrimary" class="tag">{{ store.isArabic ? 'رئيسية' : 'Primary' }}</span>
              <span class="image-name">{{ image.originalName || (store.isArabic ? 'صورة' : 'Image') }}</span>
              <span class="image-actions">
                <button type="button" class="link" :disabled="image.isPrimary || galleryBusy" @click="setPrimaryImage(image.id)">{{ store.isArabic ? 'تعيين كرئيسية' : 'Set primary' }}</button>
                <button type="button" class="link" :disabled="index === 0 || galleryBusy" :aria-label="store.isArabic ? 'نقل لأعلى' : 'Move up'" @click="moveImage(index, -1)">↑</button>
                <button type="button" class="link" :disabled="index === galleryImages.length - 1 || galleryBusy" :aria-label="store.isArabic ? 'نقل لأسفل' : 'Move down'" @click="moveImage(index, 1)">↓</button>
                <button type="button" class="link danger" :disabled="galleryBusy" @click="removeImage(image.id)">{{ store.isArabic ? 'إزالة' : 'Remove' }}</button>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import { DUPLICATE_DRAFT_KEY, DUPLICATE_QUERY_FLAG } from '@/utils/propertyDuplicate'
import { loadPropertyImageObjectUrl } from '@/utils/propertyImages'
import type { Owner, PropertyImage } from '@/types'

const props = defineProps<{ id?: string }>()
const store = useStore()
const route = useRoute()
const router = useRouter()
const loadingRecord = ref(false)
const formError = ref('')
const duplicatePrefill = ref(false)
const owners = ref<Owner[]>([])
const galleryImages = ref<PropertyImage[]>([])
const imageObjectUrls = ref<Record<string, string>>({})
const galleryBusy = ref(false)
const galleryError = ref('')

const recordId = computed(() => props.id || String(route.params.id || ''))
const isEdit = computed(() => Boolean(recordId.value))

const types = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'VILLA', 'LAND', 'COMMERCIAL']
const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE']
const classifications = ['SALE', 'RENT']
const areaUnits = ['SQ_M', 'SQ_FT']
const conditions = ['NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'UNDER_CONSTRUCTION']
const occupancyStatuses = ['VACANT', 'OWNER_OCCUPIED', 'TENANT_OCCUPIED']

interface PropertyFormState {
  title: string
  referenceNumber: string
  type: string
  status: string
  classification: string
  price: string
  currency: string
  city: string
  state: string
  country: string
  postalCode: string
  address: string
  latitude: string
  longitude: string
  bedrooms: string
  bathrooms: string
  floors: string
  area: string
  areaUnit: string
  yearBuilt: string
  condition: string
  occupancyStatus: string
  negotiable: boolean
  description: string
  features: string
  paymentTerms: string
  ownerId: string
  branchId: string
  teamId: string
}

function emptyForm(): PropertyFormState {
  return {
    title: '', referenceNumber: '', type: 'HOUSE', status: 'AVAILABLE', classification: 'SALE',
    price: '', currency: 'USD', city: '', state: '', country: '', postalCode: '', address: '',
    latitude: '', longitude: '', bedrooms: '0', bathrooms: '0', floors: '', area: '', areaUnit: 'SQ_M',
    yearBuilt: '', condition: 'GOOD', occupancyStatus: '', negotiable: false, description: '', features: '', paymentTerms: '', ownerId: '', branchId: '', teamId: ''
  }
}

const form = reactive<PropertyFormState>(emptyForm())

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

onMounted(async () => {
  void loadOwners()
  if (!isEdit.value) {
    applyDuplicateDraft()
    return
  }
  loadingRecord.value = true
  const property = await store.fetchProperty(recordId.value)
  if (property) {
    Object.assign(form, {
      title: property.title,
      referenceNumber: property.referenceNumber,
      type: property.type,
      status: property.status,
      classification: property.classification,
      price: String(property.price),
      currency: property.currency,
      city: property.city || '',
      state: property.state || '',
      country: property.country || '',
      postalCode: property.postalCode || '',
      address: property.address || '',
      latitude: property.latitude == null ? '' : String(property.latitude),
      longitude: property.longitude == null ? '' : String(property.longitude),
      bedrooms: String(property.bedrooms),
      bathrooms: String(property.bathrooms),
      floors: property.floors == null ? '' : String(property.floors),
      area: property.area == null ? '' : String(property.area),
      areaUnit: property.areaUnit,
      yearBuilt: property.yearBuilt == null ? '' : String(property.yearBuilt),
      condition: property.condition,
      occupancyStatus: property.occupancyStatus || '',
      negotiable: property.negotiable,
      description: property.description || '',
      features: property.features || '',
      paymentTerms: property.paymentTerms || '',
      ownerId: property.ownerId || '',
      branchId: (property as { branchId?: string | null }).branchId || '',
      teamId: (property as { teamId?: string | null }).teamId || ''
    })
  }
  loadingRecord.value = false
  void loadGallery()
})

onBeforeUnmount(() => releaseImageUrls())

/** Reads the sanitized server draft handed off by PropertyDetail. */
function applyDuplicateDraft(): void {
  if (String(route.query[DUPLICATE_QUERY_FLAG] || '') !== '1') return
  const raw = sessionStorage.getItem(DUPLICATE_DRAFT_KEY)
  sessionStorage.removeItem(DUPLICATE_DRAFT_KEY)
  if (!raw) return
  try {
    const draft = JSON.parse(raw) as Record<string, unknown>
    const sourceTitle = text(draft.title)
    Object.assign(form, {
      ...emptyForm(),
      title: sourceTitle ? `${sourceTitle.slice(0, 190)} (Copy)` : '',
      // No reference number, share token, id or prior status is carried over.
      referenceNumber: '',
      status: 'AVAILABLE',
      type: text(draft.type) || 'HOUSE',
      classification: text(draft.classification) || 'SALE',
      price: text(draft.price),
      currency: text(draft.currency) || 'USD',
      city: text(draft.city),
      state: text(draft.state),
      country: text(draft.country),
      postalCode: text(draft.postalCode),
      address: text(draft.address),
      latitude: text(draft.latitude),
      longitude: text(draft.longitude),
      bedrooms: text(draft.bedrooms) || '0',
      bathrooms: text(draft.bathrooms) || '0',
      floors: text(draft.floors),
      area: text(draft.area),
      areaUnit: text(draft.areaUnit) || 'SQ_M',
      yearBuilt: text(draft.yearBuilt),
      condition: text(draft.condition) || 'GOOD',
      occupancyStatus: text(draft.occupancyStatus),
      negotiable: draft.negotiable === true || draft.negotiable === 'true',
      description: text(draft.description),
      features: text(draft.features),
      paymentTerms: text(draft.paymentTerms),
      ownerId: text(draft.ownerId),
      branchId: text(draft.branchId),
      teamId: text(draft.teamId)
    })
    duplicatePrefill.value = true
  } catch {
    duplicatePrefill.value = false
  }
}

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

function releaseImageUrls(): void {
  Object.values(imageObjectUrls.value).forEach((url) => URL.revokeObjectURL(url))
  imageObjectUrls.value = {}
}

async function loadGallery(): Promise<void> {
  if (!isEdit.value) return
  releaseImageUrls()
  try {
    const response = await apiGet<PropertyImage[]>(`/properties/${recordId.value}/images`)
    galleryImages.value = [...(response.data || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const entries = await Promise.all(galleryImages.value.map(async (image) => {
      const url = await loadPropertyImageObjectUrl(recordId.value, image.id).catch(() => '')
      return [image.id, url] as const
    }))
    imageObjectUrls.value = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
  } catch {
    galleryImages.value = []
  }
}

async function onGalleryUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files || [])
  input.value = ''
  if (!selected.length) return
  galleryBusy.value = true
  galleryError.value = ''
  try {
    const body = new FormData()
    selected.forEach((file) => body.append('files', file))
    await apiPost(`/properties/${recordId.value}/images`, body)
    await loadGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

async function setPrimaryImage(imageId: string): Promise<void> {
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiPatch(`/properties/${recordId.value}/images/${imageId}`, { isPrimary: true })
    await loadGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

async function moveImage(index: number, offset: number): Promise<void> {
  const target = [...galleryImages.value]
  const swap = index + offset
  if (swap < 0 || swap >= target.length) return
  ;[target[index], target[swap]] = [target[swap], target[index]]
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiPatch(`/properties/${recordId.value}/images/reorder`, { orderedIds: target.map((image) => image.id) })
    await loadGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

async function removeImage(imageId: string): Promise<void> {
  if (!window.confirm(store.isArabic ? 'إزالة هذه الصورة؟' : 'Remove this image?')) return
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiDelete(`/properties/${recordId.value}/images/${imageId}`)
    await loadGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

function payload(): Record<string, unknown> {
  return {
    title: form.title.trim(),
    ...(form.referenceNumber && !isEdit.value ? { referenceNumber: form.referenceNumber.trim() } : {}),
    type: form.type,
    status: form.status,
    classification: form.classification,
    price: Number(form.price),
    currency: form.currency.trim() || 'USD',
    city: form.city.trim() || undefined,
    state: form.state.trim() || undefined,
    country: form.country.trim() || undefined,
    postalCode: form.postalCode.trim() || undefined,
    address: form.address.trim() || undefined,
    latitude: form.latitude !== '' ? Number(form.latitude) : undefined,
    longitude: form.longitude !== '' ? Number(form.longitude) : undefined,
    bedrooms: Number(form.bedrooms || 0),
    bathrooms: Number(form.bathrooms || 0),
    floors: form.floors !== '' ? Number(form.floors) : undefined,
    area: form.area ? Number(form.area) : undefined,
    areaUnit: form.areaUnit,
    yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : undefined,
    condition: form.condition,
    occupancyStatus: form.occupancyStatus || undefined,
    negotiable: form.negotiable,
    description: form.description.trim() || undefined,
    features: form.features.trim() || undefined,
    paymentTerms: form.paymentTerms.trim() || undefined,
    ownerId: form.ownerId || '',
    branchId: form.branchId.trim() || undefined,
    teamId: form.teamId.trim() || undefined
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
label.checkbox { flex-direction: row; align-items: center; gap: 0.5rem; }
label.checkbox input { width: auto; }
.notice { background: #eef2ff; color: #3730a3; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.84rem; margin-bottom: 0.8rem; }
small { color: #9ca3af; font-size: 0.7rem; }
input, select, textarea { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.55rem 0.65rem; font-size: 0.9rem; font-family: inherit; }
.actions { display: flex; gap: 0.6rem; margin-top: 1.2rem; }
.btn { display: inline-flex; align-items: center; border-radius: 8px; padding: 0.6rem 1rem; text-decoration: none; font-size: 0.88rem; }
.btn-primary { background: #4f46e5; color: #fff; border: 0; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.error { margin-top: 1rem; padding: 0.6rem 0.8rem; background: #fef2f2; color: #991b1b; border-radius: 8px; font-size: 0.85rem; }
.state { padding: 2rem; text-align: center; color: #6b7280; }
.gallery-panel { margin-top: 1.2rem; border-top: 1px solid #e5e7eb; padding-top: 1rem; }
.gallery-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem; }
.gallery-heading h2 { font-size: 1rem; margin: 0; }
.gallery-hint { color: #9ca3af; font-size: 0.75rem; margin: 0.35rem 0 0.7rem; }
.upload-btn { cursor: pointer; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
.gallery-item { margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #f9fafb; }
.gallery-item img, .image-placeholder { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: grid; place-items: center; background: #eef2ff; color: #94a3b8; }
.gallery-item figcaption { display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0.5rem; }
.image-name { font-size: 0.75rem; color: #374151; word-break: break-word; }
.image-actions { display: inline-flex; flex-wrap: wrap; gap: 0.4rem; }
.image-actions .link { margin: 0; padding: 0; font-size: 0.75rem; }
.image-actions .link:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
