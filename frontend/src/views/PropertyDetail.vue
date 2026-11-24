<template>
  <div class="page">
    <div class="page-head">
      <router-link to="/properties" class="back">{{ store.isArabic ? '→' : '←' }} {{ store.isArabic ? 'العودة للقائمة' : 'Back to list' }}</router-link>
      <div class="head-actions">
        <button v-if="property" class="btn btn-quiet" type="button" :disabled="sharing" @click="onShareSummary">
          <i class="fas fa-share-from-square"></i>
          {{ store.isArabic ? 'مشاركة العقار' : 'Share Property' }}
        </button>
        <button v-if="property" class="btn btn-whatsapp no-print" type="button" :disabled="sharing" @click="whatsappForProperty">
          <i class="fab fa-whatsapp"></i>
          {{ store.isArabic ? 'واتساب' : 'WhatsApp' }}
        </button>
        <template v-if="property && (store.canManage || isAssignedAgent)">
          <button class="btn btn-quiet" type="button" @click="onDuplicate">
            <i class="fas fa-copy"></i> {{ store.isArabic ? 'نسخ العقار' : 'Duplicate Property' }}
          </button>
          <router-link class="btn btn-quiet" :to="`/properties/${property.id}/edit`">
            <i class="fas fa-pen"></i> {{ store.isArabic ? 'تعديل' : 'Edit' }}
          </router-link>
          <div class="delete-wrap">
            <button class="btn btn-danger" type="button" :disabled="store.loading" @click="onDelete">
              <i class="fas fa-trash"></i> {{ confirmDelete ? (store.isArabic ? 'تأكيد الأرشفة' : 'Confirm archive') : (store.isArabic ? 'أرشفة' : 'Archive') }}
            </button>
            <small v-if="confirmDelete" class="confirm-hint">{{ store.isArabic ? 'انقر مرة أخرى للتأكيد' : 'Click again to confirm' }}</small>
          </div>
        </template>
      </div>
    </div>

    <div v-if="store.loading && !property" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!property" class="state">{{ store.isArabic ? 'العقار غير موجود.' : 'Property not found.' }}</div>

    <template v-else>
      <header class="hero">
        <div>
          <span class="badge">{{ property.referenceNumber }}</span>
          <h1>{{ property.title }}</h1>
          <p class="muted">
            <i class="fas fa-location-dot"></i>
            {{ [property.address, property.city, property.state, property.country].filter(Boolean).join(', ') || '—' }}
          </p>
        </div>
        <div class="price">
          <strong>{{ money(property.price, property.currency) }}</strong>
          <div v-if="canChangeStatus" class="status-control">
            <select :value="property.status" :disabled="store.loading" @change="onStatusChange">
              <option v-for="status in statusOptions" :key="status" :value="status">{{ label(status) }}</option>
            </select>
          </div>
          <span v-else class="badge">{{ label(property.status) }}</span>
        </div>
      </header>

      <div v-if="actionError" class="error" role="alert">{{ actionError }}</div>
      <div v-if="shareMessage" class="notice" role="status">{{ shareMessage }}</div>

      <section v-if="sharePreview" class="panel share-fallback">
        <h2>{{ store.isArabic ? 'نسخ الملخص يدويًا' : 'Copy the summary manually' }}</h2>
        <textarea :value="sharePreview" readonly rows="12" @focus="selectSharePreview"></textarea>
      </section>

      <section v-if="canEditProperty" class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'رابط المشاركة العام' : 'Public share link' }}</h2>
          <span v-if="shareLink?.enabled" class="tag">{{ store.isArabic ? 'مفعّل' : 'Active' }}</span>
        </div>
        <p class="muted">
          {{ store.isArabic
            ? 'يتيح الرابط للعملاء عرض العقار دون تسجيل دخول. يمكن تدوير الرابط أو إلغاؤه في أي وقت.'
            : 'Anyone with the link can view the property without signing in. Rotate or revoke it at any time.' }}
        </p>
        <div v-if="shareLink?.enabled" class="share-controls">
          <input :value="shareLink.url || ''" readonly :aria-label="store.isArabic ? 'رابط المشاركة' : 'Share URL'" @focus="selectSharePreview" />
          <button class="btn btn-quiet" type="button" :disabled="shareBusy" @click="onCopyShareLink">{{ store.isArabic ? 'نسخ' : 'Copy' }}</button>
          <button class="btn btn-quiet" type="button" :disabled="shareBusy" @click="onRotateShareLink">{{ store.isArabic ? 'تدوير' : 'Rotate' }}</button>
          <button class="btn btn-danger" type="button" :disabled="shareBusy" @click="onRevokeShareLink">{{ store.isArabic ? 'إلغاء' : 'Revoke' }}</button>
        </div>
        <button v-else class="btn btn-quiet" type="button" :disabled="shareBusy" @click="onGenerateShareLink">
          <i class="fas fa-link"></i> {{ store.isArabic ? 'إنشاء رابط عام' : 'Generate public link' }}
        </button>
        <small v-if="shareLink?.expiresAt" class="share-expiry">
          {{ store.isArabic ? 'تنتهي في' : 'Expires' }}: {{ formatDate(shareLink.expiresAt) }}
        </small>
      </section>

      <section class="panel">
        <h2>{{ store.isArabic ? 'المواصفات' : 'Specifications' }}</h2>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'النوع' : 'Type' }}</dt><dd>{{ label(property.type) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'التصنيف' : 'Classification' }}</dt><dd>{{ label(property.classification) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt><dd>{{ property.bedrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الحمامات' : 'Bathrooms' }}</dt><dd>{{ property.bathrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المساحة' : 'Area' }}</dt><dd>{{ property.area ?? '—' }} {{ property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'سنة البناء' : 'Year built' }}</dt><dd>{{ property.yearBuilt ?? '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الحالة' : 'Condition' }}</dt><dd>{{ label(property.condition) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الإشغال' : 'Occupancy' }}</dt><dd>{{ property.occupancyStatus ? label(property.occupancyStatus) : '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'متاح من' : 'Available from' }}</dt><dd>{{ formatDate(property.availableFrom) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'قابل للتفاوض' : 'Negotiable' }}</dt><dd>{{ property.negotiable ? '✓' : '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'مميز' : 'Featured' }}</dt><dd>{{ property.featured ? '✓' : '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المالك' : 'Owner' }}</dt><dd>{{ ownerLabel(property.owner) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الوكيل' : 'Agent' }}</dt><dd>{{ property.assignedAgent?.firstName || property.assignedAgent?.email || '—' }}</dd></div>
        </dl>
      </section>

      <section class="panel price-history-panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'تاريخ السعر' : 'Price History' }}</h2>
          <span class="tag">{{ priceHistory.length }}</span>
        </div>
        <div v-if="!priceHistory.length" class="empty">
          {{ store.isArabic ? 'لا توجد تغييرات في السعر.' : 'No price changes recorded.' }}
        </div>
        <ol v-else class="price-timeline">
          <li v-for="entry in priceHistory" :key="entry.id">
            <div class="price-change-head">
              <strong>{{ money(entry.oldPrice, entry.oldCurrency) }}</strong>
              <span aria-hidden="true">{{ store.isArabic ? '←' : '→' }}</span>
              <strong class="new-price">{{ money(entry.newPrice, entry.newCurrency) }}</strong>
              <time :datetime="entry.timestamp">{{ formatDate(entry.timestamp) }}</time>
            </div>
            <p v-if="entry.oldCurrency !== entry.newCurrency" class="currency-change">
              {{ store.isArabic ? 'تغيّر العملة' : 'Currency changed' }}: {{ entry.oldCurrency }} {{ store.isArabic ? '←' : '→' }} {{ entry.newCurrency }}
            </p>
          </li>
        </ol>
      </section>

      <section v-if="property.description || property.operationalNotes" class="panel">
        <h2>{{ store.isArabic ? 'ملاحظات' : 'Notes' }}</h2>
        <p v-if="property.description" class="description">{{ property.description }}</p>
        <p v-if="property.operationalNotes" class="description">{{ property.operationalNotes }}</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'معرض الصور' : 'Image gallery' }}</h2>
          <label v-if="canEditProperty" class="btn btn-quiet upload-btn">
            <i class="fas fa-upload"></i> {{ store.isArabic ? 'رفع صور' : 'Upload images' }}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onUploadImages" />
          </label>
        </div>
        <div v-if="galleryError" class="error inline-error" role="alert">{{ galleryError }}</div>
        <div v-if="uploadingImages" class="empty">{{ store.isArabic ? 'جارٍ رفع الصور…' : 'Uploading images…' }}</div>
        <div v-if="!galleryImages.length && !uploadingImages" class="empty">{{ store.isArabic ? 'لا توجد صور لهذا العقار.' : 'No images for this property.' }}</div>
        <div v-else class="gallery-grid">
          <figure v-for="(image, index) in galleryImages" :key="image.id" class="gallery-item" :class="{ primary: image.isPrimary }">
            <img v-if="imageObjectUrls[image.id]" :src="imageObjectUrls[image.id]" :alt="image.originalName || property.title" loading="lazy" />
            <div v-else class="image-placeholder"><i class="fas fa-image"></i></div>
            <figcaption>
              <span v-if="image.isPrimary" class="tag primary-tag">{{ store.isArabic ? 'رئيسية' : 'Primary' }}</span>
              <span class="image-name">{{ image.originalName || (store.isArabic ? 'صورة' : 'Image') }}</span>
            </figcaption>
            <div v-if="canEditProperty" class="image-actions">
              <button type="button" class="link" :disabled="image.isPrimary || galleryBusy" @click="setPrimaryImage(image.id)">{{ store.isArabic ? 'تعيين كرئيسية' : 'Set primary' }}</button>
              <button type="button" class="link" :disabled="index === 0 || galleryBusy" @click="moveImage(index, -1)">↑</button>
              <button type="button" class="link" :disabled="index === galleryImages.length - 1 || galleryBusy" @click="moveImage(index, 1)">↓</button>
              <button type="button" class="link danger" :disabled="galleryBusy" @click="removeImage(image.id)">{{ store.isArabic ? 'إزالة' : 'Remove' }}</button>
            </div>
          </figure>
        </div>
      </section>

      <PropertyAttachmentsPanel :property-id="property.id" :can-edit="canEditProperty" />

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'الوثائق' : 'Documents' }}</h2>
          <router-link to="/documents">{{ store.isArabic ? 'إدارة الوثائق' : 'Manage documents' }} {{ store.isArabic ? '←' : '→' }}</router-link>
        </div>
        <div v-if="!property.linkedDocuments?.length" class="empty">{{ store.isArabic ? 'لا توجد وثائق مرتبطة.' : 'No linked documents.' }}</div>
        <div v-else class="list">
          <div v-for="document in property.linkedDocuments" :key="document.id" class="list-row">
            <span><i class="fas fa-file"></i> {{ document.name }}</span>
            <button type="button" class="link" @click="onDownload(document.id, document.originalName)">
              {{ store.isArabic ? 'تنزيل' : 'Download' }}
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>{{ store.isArabic ? 'الصيانة' : 'Maintenance' }}</h2>
          <router-link to="/maintenance">{{ store.isArabic ? 'كل الطلبات' : 'All requests' }} {{ store.isArabic ? '←' : '→' }}</router-link>
        </div>
        <div v-if="!property.maintenanceRequests?.length" class="empty">{{ store.isArabic ? 'لا توجد طلبات صيانة.' : 'No maintenance requests.' }}</div>
        <div v-else class="list">
          <div v-for="request in property.maintenanceRequests" :key="request.id" class="list-row">
            <span>{{ request.title }}</span>
            <span class="tag">{{ label(request.status) }}</span>
            <span class="tag">{{ label(request.priority) }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>{{ store.isArabic ? 'الصفقات' : 'Deals' }}</h2>
        <div v-if="!property.deals?.length" class="empty">{{ store.isArabic ? 'لا توجد صفقات مرتبطة.' : 'No linked deals.' }}</div>
        <div v-else class="list">
          <router-link v-for="deal in property.deals" :key="deal.id" class="list-row" :to="`/deals/${deal.id}`">
            <span>{{ deal.referenceNumber || deal.id }}</span>
            <span>{{ money(deal.amount, deal.currency) }}</span>
            <span class="tag">{{ label(deal.status) }}</span>
          </router-link>
        </div>
      </section>

      <ActivityTimeline entity-type="Property" :entity-id="property.id" :limit="10" :show-filters="false" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import PropertyAttachmentsPanel from '@/components/PropertyAttachmentsPanel.vue'
import { downloadDocument } from '@/utils/documents'
import { loadPropertyImageObjectUrl } from '@/utils/propertyImages'
import { buildClientPropertySummary } from '@/utils/propertyShare'
import { openWhatsAppChat } from '@/utils/whatsapp'
import { parsePriceHistory } from '@/utils/priceHistory'
import { DUPLICATE_DRAFT_KEY, DUPLICATE_QUERY_FLAG } from '@/utils/propertyDuplicate'
import { useStore } from '@/stores'
import type { DocumentRecord, PropertyDetail, PropertyImage, PropertyShareLink } from '@/types'

const props = defineProps<{ id?: string }>()
const store = useStore()
const route = useRoute()
const router = useRouter()
const confirmDelete = ref(false)
const actionError = ref('')
const shareMessage = ref('')
const sharePreview = ref('')
const sharing = ref(false)
const shareBusy = ref(false)
const shareLink = ref<PropertyShareLink | null>(null)
const galleryError = ref('')
const uploadingImages = ref(false)
const galleryBusy = ref(false)
const galleryImages = ref<PropertyImage[]>([])
const imageObjectUrls = ref<Record<string, string>>({})

const recordId = computed(() => props.id || String(route.params.id || ''))
onMounted(() => void store.fetchProperty(recordId.value))
const property = computed<PropertyDetail | null>(() => store.currentProperty)
const priceHistory = computed(() => parsePriceHistory(property.value?.activities))

const isAssignedAgent = computed(() =>
  Boolean(store.user && property.value && store.user.role === 'AGENT' && property.value.assignedAgentId === store.user.id)
)
const canChangeStatus = computed(() => store.canManage || isAssignedAgent.value)
const canEditProperty = computed(() => store.canManage || isAssignedAgent.value)

const TRANSITIONS: Record<string, string[]> = {
  AVAILABLE: ['AVAILABLE', 'PENDING', 'RESERVED', 'UNDER_NEGOTIATION', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE'],
  PENDING: ['PENDING', 'AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION', 'SOLD', 'RENTED', 'UNAVAILABLE'],
  RESERVED: ['RESERVED', 'AVAILABLE', 'PENDING', 'UNDER_NEGOTIATION', 'SOLD', 'RENTED', 'UNAVAILABLE'],
  SOLD: ['SOLD'],
  RENTED: ['RENTED', 'AVAILABLE'],
  OFF_MARKET: ['OFF_MARKET', 'AVAILABLE'],
  UNAVAILABLE: ['UNAVAILABLE', 'AVAILABLE'],
  UNDER_NEGOTIATION: ['UNDER_NEGOTIATION', 'AVAILABLE', 'PENDING', 'RESERVED', 'SOLD', 'UNAVAILABLE']
}

const statusOptions = computed(() => TRANSITIONS[property.value?.status || ''] || [property.value?.status || 'AVAILABLE'])

const VALUE_LABELS: Record<string, [string, string]> = {
  AVAILABLE: ['Available', 'متاحة'],
  UNDER_NEGOTIATION: ['Under negotiation', 'قيد التفاوض'],
  PENDING: ['Pending', 'قيد الانتظار'],
  RESERVED: ['Reserved', 'محجوزة'],
  SOLD: ['Sold', 'مباعة'],
  RENTED: ['Rented', 'مؤجرة'],
  OFF_MARKET: ['Off market', 'خارج السوق'],
  UNAVAILABLE: ['Unavailable', 'غير متاحة'],
  HOUSE: ['House', 'منزل'],
  APARTMENT: ['Apartment', 'شقة'],
  CONDO: ['Condo', 'شقة مملوكة'],
  TOWNHOUSE: ['Townhouse', 'منزل متصل'],
  VILLA: ['Villa', 'فيلا'],
  LAND: ['Land', 'أرض'],
  COMMERCIAL: ['Commercial', 'تجاري'],
  RESIDENTIAL: ['Residential', 'سكني'],
  MIXED_USE: ['Mixed use', 'استخدام مختلط'],
  EXCELLENT: ['Excellent', 'ممتاز'],
  GOOD: ['Good', 'جيد'],
  FAIR: ['Fair', 'مقبول'],
  POOR: ['Poor', 'ضعيف'],
  NEEDS_RENOVATION: ['Needs renovation', 'يحتاج ترميماً'],
  VACANT: ['Vacant', 'شاغر'],
  OCCUPIED: ['Occupied', 'مشغول'],
  OWNER_OCCUPIED: ['Owner occupied', 'مشغول من المالك'],
  TENANT_OCCUPIED: ['Tenant occupied', 'مشغول من مستأجر'],
  LOW: ['Low', 'منخفضة'],
  MEDIUM: ['Medium', 'متوسطة'],
  HIGH: ['High', 'عالية'],
  URGENT: ['Urgent', 'عاجلة'],
  DRAFT: ['Draft', 'مسودة'],
  ACTIVE: ['Active', 'نشطة'],
  COMPLETED: ['Completed', 'مكتملة'],
  CANCELLED: ['Cancelled', 'ملغية'],
  CLOSED: ['Closed', 'مغلقة'],
  OPEN: ['Open', 'مفتوح'],
  IN_PROGRESS: ['In progress', 'قيد التنفيذ'],
  RESOLVED: ['Resolved', 'تم حلها']
}

function label(value: string): string {
  const pair = VALUE_LABELS[value]
  if (pair) return store.isArabic ? pair[1] : pair[0]
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(store.isArabic ? 'ar' : 'en')
}

function money(amount: string | number, currency: string): string {
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', { style: 'currency', currency }).format(Number(amount))
  } catch {
    return `${amount} ${currency}`
  }
}

function selectSharePreview(event: Event): void {
  (event.target as HTMLTextAreaElement).select()
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to the legacy selection-based copy below.
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

async function onShareSummary(): Promise<void> {
  if (!property.value || sharing.value) return
  actionError.value = ''
  shareMessage.value = ''
  sharePreview.value = ''
  const propertyId = property.value.id
  const summary = buildClientPropertySummary(property.value, { isArabic: store.isArabic })
  sharing.value = true
  try {
    if (await copyText(summary)) {
      shareMessage.value = store.isArabic
        ? 'تم نسخ ملخص العقار الجاهز للعميل.'
        : 'Client-ready property summary copied.'
    } else {
      sharePreview.value = summary
      actionError.value = store.isArabic
        ? 'تعذّر النسخ تلقائيًا. انسخ الملخص من الحقل أدناه.'
        : 'Automatic copy was blocked. Copy the summary from the field below.'
    }
  } finally {
    sharing.value = false
  }
  // Log on generation (including the manual-copy fallback). Best-effort: never
  // undo a successful copy or hide the preview because an audit write failed.
  try {
    await apiPost(`/properties/${propertyId}/share-summary`)
  } catch {
    // Activity logging is secondary to sharing the summary.
  }
}

async function loadShareLink(): Promise<void> {
  if (!property.value || !canEditProperty.value) {
    shareLink.value = null
    return
  }
  try {
    shareLink.value = (await apiGet<PropertyShareLink>(`/properties/${property.value.id}/share-link`)).data
  } catch {
    shareLink.value = null
  }
}

async function onGenerateShareLink(): Promise<void> {
  if (!property.value || shareBusy.value) return
  shareBusy.value = true
  actionError.value = ''
  try {
    shareLink.value = (await apiPost<PropertyShareLink>(`/properties/${property.value.id}/share-link`, {})).data
    shareMessage.value = store.isArabic ? 'تم إنشاء رابط المشاركة.' : 'Public share link created.'
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    shareBusy.value = false
  }
}

async function onRotateShareLink(): Promise<void> {
  // Rotation reuses the create endpoint: it issues a new token and invalidates
  // the previous one without changing the property record itself.
  if (!window.confirm(store.isArabic ? 'سيتوقف الرابط القديم عن العمل. متابعة؟' : 'The old link will stop working. Continue?')) return
  await onGenerateShareLink()
}

async function onRevokeShareLink(): Promise<void> {
  if (!property.value || shareBusy.value) return
  if (!window.confirm(store.isArabic ? 'إلغاء رابط المشاركة؟' : 'Revoke the public share link?')) return
  shareBusy.value = true
  actionError.value = ''
  try {
    await apiDelete(`/properties/${property.value.id}/share-link`)
    shareLink.value = null
    shareMessage.value = store.isArabic ? 'تم إلغاء رابط المشاركة.' : 'Public share link revoked.'
  } catch (error) {
    actionError.value = errorMessage(error)
  } finally {
    shareBusy.value = false
  }
}

async function onCopyShareLink(): Promise<void> {
  const url = shareLink.value?.url
  if (!url) return
  shareMessage.value = await copyText(url)
    ? (store.isArabic ? 'تم نسخ رابط المشاركة.' : 'Share link copied.')
    : (store.isArabic ? 'تعذّر النسخ تلقائيًا.' : 'Automatic copy was blocked.')
}

async function onStatusChange(event: Event): Promise<void> {
  if (!property.value) return
  const status = (event.target as HTMLSelectElement).value
  actionError.value = ''
  try {
    await apiPatch(`/properties/${property.value.id}/status`, { status })
    await store.fetchProperty(property.value.id)
  } catch (error) {
    actionError.value = errorMessage(error)
    await store.fetchProperty(property.value.id)
  }
}

async function onDownload(id: string, name: string): Promise<void> {
  try {
    await downloadDocument(id, name)
  } catch (error) {
    actionError.value = errorMessage(error)
  }
}

async function onDuplicate(): Promise<void> {
  if (!property.value) return
  actionError.value = ''
  try {
    // The server returns a sanitized allowlist draft; the form reads it from
    // session storage after navigating to /properties/new.
    const response = await apiGet<Record<string, unknown>>(`/properties/${property.value.id}/duplicate-draft`)
    sessionStorage.setItem(DUPLICATE_DRAFT_KEY, JSON.stringify(response.data))
    await router.push({ path: '/properties/new', query: { [DUPLICATE_QUERY_FLAG]: '1' } })
  } catch (error) {
    actionError.value = errorMessage(error)
  }
}

async function onDelete(): Promise<void> {
  if (!property.value) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    window.setTimeout(() => { confirmDelete.value = false }, 4000)
    return
  }
  await store.deleteProperty(property.value.id)
  await router.push('/properties')
}

function ownerLabel(owner: unknown): string {
  if (!owner || typeof owner !== 'object') return '—'
  const record = owner as Record<string, unknown>
  const company = typeof record.companyName === 'string' ? record.companyName.trim() : ''
  const person = [record.firstName, record.lastName].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ').trim()
  return company || person || (typeof record.email === 'string' ? record.email : '—')
}

async function whatsappForProperty(): Promise<void> {
  const current = property.value
  if (!current) return
  let link = shareLink.value?.url || undefined
  if (!link) {
    await onGenerateShareLink()
    link = shareLink.value?.url || undefined
  }
  const owner = current.owner as Record<string, unknown> | null | undefined
  const leadPhone = current.leads?.find((lead) => Boolean(lead.phone))?.phone
  const opened = openWhatsAppChat({
    phone: leadPhone || owner?.phone,
    template: 'propertyShare',
    payload: {
      title: current.title,
      reference: current.referenceNumber,
      price: current.price,
      currency: current.currency,
      city: current.city,
      address: current.address,
      bedrooms: current.bedrooms,
      bathrooms: current.bathrooms,
      area: current.area,
      areaUnit: current.areaUnit,
      link
    },
    language: store.isArabic ? 'ar' : 'en'
  })
  if (!opened) {
    actionError.value = store.isArabic
      ? 'لا يوجد رقم واتساب صالح للمالك أو العميل المرتبط.'
      : 'No valid WhatsApp number is available for the owner or a linked lead.'
  }
}

function revokeImageUrls(): void {
  Object.values(imageObjectUrls.value).forEach((url) => URL.revokeObjectURL(url))
  imageObjectUrls.value = {}
}

async function loadGalleryImages(): Promise<void> {
  revokeImageUrls()
  const images = [...(property.value?.images || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  galleryImages.value = images
  const entries = await Promise.all(images.map(async (image) => {
    try {
      const url = await loadPropertyImageObjectUrl(recordId.value, image.id)
      return [image.id, url] as const
    } catch {
      return null
    }
  }))
  imageObjectUrls.value = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)))
}

async function refreshPropertyAndGallery(): Promise<void> {
  await store.fetchProperty(recordId.value)
  await loadGalleryImages()
}

async function onUploadImages(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length || !property.value) return
  galleryError.value = ''
  uploadingImages.value = true
  try {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    await apiPost(`/properties/${property.value.id}/images`, form)
    await refreshPropertyAndGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    uploadingImages.value = false
    input.value = ''
  }
}

async function setPrimaryImage(imageId: string): Promise<void> {
  if (!property.value) return
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiPatch(`/properties/${property.value.id}/images/${imageId}`, { isPrimary: true })
    await refreshPropertyAndGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

async function moveImage(index: number, direction: -1 | 1): Promise<void> {
  if (!property.value) return
  const target = index + direction
  if (target < 0 || target >= galleryImages.value.length) return
  const orderedIds = galleryImages.value.map((image) => image.id)
  const [moved] = orderedIds.splice(index, 1)
  orderedIds.splice(target, 0, moved)
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiPatch(`/properties/${property.value.id}/images/reorder`, { orderedIds })
    await refreshPropertyAndGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

async function removeImage(imageId: string): Promise<void> {
  if (!property.value) return
  if (!window.confirm(store.isArabic ? 'إزالة هذه الصورة؟' : 'Remove this image?')) return
  galleryBusy.value = true
  galleryError.value = ''
  try {
    await apiDelete(`/properties/${property.value.id}/images/${imageId}`)
    await refreshPropertyAndGallery()
  } catch (error) {
    galleryError.value = errorMessage(error)
  } finally {
    galleryBusy.value = false
  }
}

watch(property, () => {
  if (property.value) {
    void loadGalleryImages()
    void loadShareLink()
  } else {
    galleryImages.value = []
    shareLink.value = null
    revokeImageUrls()
  }
}, { immediate: true })

onBeforeUnmount(() => { revokeImageUrls() })
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; }
.back, .head-actions { display: inline-flex; gap: 0.5rem; }
.back { color: #4f46e5; text-decoration: none; font-size: 0.88rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.86rem; cursor: pointer; text-decoration: none; border: 0; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.btn-whatsapp { background: #e7f7f2; color: #075e54; border: 1px solid #b7e4d8; }
.btn-whatsapp:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
.hero { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; }
h1 { margin: 0.5rem 0 0.2rem; font-size: 1.5rem; }
h2 { font-size: 1.05rem; margin: 0 0 0.9rem; }
.muted { color: #6b7280; margin: 0; font-size: 0.86rem; }
.price { display: flex; flex-direction: column; align-items: end; gap: 0.4rem; }
.price strong { font-size: 1.5rem; color: #4338ca; }
.badge, .tag { font-size: 0.7rem; color: #3730a3; background: #e0e7ff; padding: 0.2rem 0.6rem; border-radius: 999px; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.3rem; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
.panel-head a { color: #4f46e5; font-size: 0.82rem; text-decoration: none; }
.upload-btn { cursor: pointer; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.9rem; }
.gallery-item { margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #f9fafb; display: flex; flex-direction: column; }
.gallery-item.primary { border-color: #818cf8; box-shadow: 0 0 0 1px #c7d2fe inset; }
.gallery-item img, .image-placeholder { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #eef2ff; }
.image-placeholder { display: grid; place-items: center; color: #94a3b8; font-size: 1.4rem; }
.gallery-item figcaption { padding: 0.5rem 0.6rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.image-name { font-size: 0.75rem; color: #374151; word-break: break-word; }
.primary-tag { align-self: flex-start; }
.image-actions { display: flex; flex-wrap: wrap; gap: 0.35rem 0.55rem; padding: 0.45rem 0.6rem 0.6rem; }
.image-actions .link { margin: 0; font-size: 0.75rem; padding: 0; }
.image-actions .link:disabled { opacity: 0.4; cursor: not-allowed; }
.inline-error { margin-bottom: 0.8rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.9rem; margin: 0; }
.facts dt { font-size: 0.75rem; color: #6b7280; }
.facts dd { margin: 0.2rem 0 0; font-weight: 600; font-size: 0.92rem; }
.description { color: #374151; line-height: 1.7; white-space: pre-wrap; }
.list { display: flex; flex-direction: column; }
.list-row { display: flex; align-items: center; gap: 0.8rem; padding: 0.65rem 0; border-block-end: 1px solid #f3f4f6; font-size: 0.86rem; color: #374151; text-decoration: none; }
.list-row span:first-child { flex: 1; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.82rem; }
.empty, .state { padding: 1.2rem; text-align: center; color: #6b7280; font-size: 0.88rem; background: #fff; border-radius: 12px; }
.timeline { list-style: none; padding: 0; margin: 0; }
.timeline li { padding-block: 0.6rem; padding-inline-start: 1rem; border-inline-start: 2px solid #c7d2fe; position: relative; font-size: 0.86rem; }
.timeline li span { color: #6b7280; font-size: 0.76rem; margin-inline-start: 0.6rem; }
.timeline li p { margin: 0.2rem 0 0; color: #4b5563; }
.price-timeline { list-style: none; margin: 0; padding: 0; }
.price-timeline li { padding-block: 0.55rem; padding-inline-start: 0.9rem; border-inline-start: 2px solid #c7d2fe; }
.price-timeline li:last-child { border-inline-start-color: transparent; }
.price-change-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; font-size: 0.9rem; }
.price-change-head strong { color: #6b7280; text-decoration: line-through; }
.price-change-head .new-price { color: #166534; text-decoration: none; }
.price-change-head time { color: #6b7280; font-size: 0.76rem; margin-inline-start: auto; }
.currency-change { margin: 0.2rem 0 0; font-size: 0.76rem; color: #92400e; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.65rem 0.8rem; font-size: 0.85rem; }
.notice { background: #ecfdf5; color: #065f46; border-radius: 8px; padding: 0.65rem 0.8rem; font-size: 0.85rem; }
.share-fallback textarea { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 0.7rem; font-family: inherit; font-size: 0.84rem; resize: vertical; }
.share-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.share-controls input { flex: 1 1 280px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.82rem; }
.share-expiry { display: block; margin-top: 0.5rem; color: #6b7280; font-size: 0.76rem; }
select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.4rem 0.6rem; font-size: 0.84rem; }
</style>
