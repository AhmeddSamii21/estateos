<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'البحث المتقدم والخريطة' : 'Advanced search & map' }}</h1>
        <p class="muted">{{ store.isArabic ? 'ابحث بالمعايير واستعرض النتائج جغرافيًا' : 'Filter properties and explore results geographically' }}</p>
      </div>
      <router-link class="btn btn-quiet" to="/properties">{{ store.isArabic ? 'القائمة البسيطة' : 'Simple list' }}</router-link>
    </div>

    <form class="filters" @submit.prevent="apply">
      <label>
        <span>{{ store.isArabic ? 'كلمة البحث' : 'Keyword' }}</span>
        <input v-model="form.keyword" type="search" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'المدينة' : 'City' }}</span>
        <input v-model="form.city" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'النوع' : 'Type' }}</span>
        <select v-model="form.type">
          <option value="">—</option>
          <option v-for="option in types" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
        <select v-model="form.status">
          <option value="">—</option>
          <option v-for="option in statuses" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'التوفر' : 'Availability' }}</span>
        <select v-model="form.availability">
          <option value="">—</option>
          <option value="available">{{ store.isArabic ? 'متاح' : 'Available' }}</option>
          <option value="unavailable">{{ store.isArabic ? 'غير متاح' : 'Unavailable' }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'العملة' : 'Currency' }}</span>
        <input v-model="form.currency" maxlength="3" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأدنى للسعر' : 'Min price' }}</span>
        <input v-model="form.minPrice" type="number" min="0" step="0.01" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأعلى للسعر' : 'Max price' }}</span>
        <input v-model="form.maxPrice" type="number" min="0" step="0.01" />
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
        <span>{{ store.isArabic ? 'أقل مساحة' : 'Min area' }}</span>
        <input v-model="form.minArea" type="number" min="0" step="0.01" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'أكبر مساحة' : 'Max area' }}</span>
        <input v-model="form.maxArea" type="number" min="0" step="0.01" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'مميز' : 'Featured' }}</span>
        <select v-model="form.featured">
          <option value="">—</option>
          <option value="true">{{ store.isArabic ? 'نعم' : 'Yes' }}</option>
          <option value="false">{{ store.isArabic ? 'لا' : 'No' }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الترتيب' : 'Sort' }}</span>
        <select v-model="form.sort">
          <option value="newest">{{ store.isArabic ? 'الأحدث' : 'Newest' }}</option>
          <option value="price_asc">{{ store.isArabic ? 'السعر تصاعدي' : 'Price ascending' }}</option>
          <option value="price_desc">{{ store.isArabic ? 'السعر تنازلي' : 'Price descending' }}</option>
          <option value="area_desc">{{ store.isArabic ? 'المساحة تنازلي' : 'Area descending' }}</option>
        </select>
      </label>
      <div class="filter-actions">
        <button class="btn btn-primary" type="submit">{{ store.isArabic ? 'بحث' : 'Search' }}</button>
        <button class="btn btn-quiet" type="button" @click="clear">{{ store.isArabic ? 'مسح' : 'Clear' }}</button>
        <button class="btn btn-quiet" type="button" @click="useMapBounds">{{ store.isArabic ? 'حدود الخريطة' : 'Use map bounds' }}</button>
      </div>
    </form>

    <div class="results-layout">
      <div class="results">
        <div class="results-head">
          <strong>{{ pagination.total }} {{ store.isArabic ? 'نتيجة' : 'results' }}</strong>
          <span v-if="loading">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</span>
        </div>
        <div v-if="!loading && !results.length" class="empty">{{ store.isArabic ? 'لا توجد نتائج مطابقة.' : 'No matching properties.' }}</div>
        <PropertyItem v-for="property in results" :key="property.id" :property="property" @select="open" />
        <div v-if="pagination.pages > 1" class="pager">
          <button type="button" :disabled="page <= 1" @click="go(page - 1)">‹</button>
          <span>{{ page }} / {{ pagination.pages }}</span>
          <button type="button" :disabled="page >= pagination.pages" @click="go(page + 1)">›</button>
        </div>
      </div>
      <div ref="mapElement" class="map" aria-label="Property map"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useRouter } from 'vue-router'
import { apiGet, errorMessage } from '@/api/client'
import PropertyItem from '@/components/PropertyItem.vue'
import { useStore } from '@/stores'
import type { Property } from '@/types'

const store = useStore()
const router = useRouter()
const mapElement = ref<HTMLDivElement | null>(null)
const results = ref<Property[]>([])
const loading = ref(false)
const page = ref(1)
const pagination = ref({ page: 1, limit: 24, total: 0, pages: 0 })
let map: L.Map | null = null
let markers: L.LayerGroup | null = null

const types = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'VILLA', 'LAND', 'COMMERCIAL']
const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE']

const emptyForm = () => ({
  keyword: '',
  city: '',
  type: '',
  status: '',
  availability: '',
  currency: '',
  minPrice: '',
  maxPrice: '',
  bedrooms: '',
  bathrooms: '',
  minArea: '',
  maxArea: '',
  featured: '',
  sort: 'newest',
  minLatitude: '',
  maxLatitude: '',
  minLongitude: '',
  maxLongitude: ''
})

const form = reactive(emptyForm())

onMounted(() => {
  map = L.map(mapElement.value as HTMLDivElement, { center: [24.7136, 46.6753], zoom: 6 })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map)
  markers = L.layerGroup().addTo(map)
  void load()
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
  markers = null
})

watch(results, () => { void nextTick(renderMarkers) })

function params(): Record<string, string | number> {
  const output: Record<string, string | number> = {}
  Object.entries(form).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') output[key] = value
  })
  output.page = page.value
  output.limit = 24
  return output
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const response = await apiGet<Property[]>('/properties/search', { params: params() })
    results.value = response.data ?? []
    if (response.pagination) pagination.value = response.pagination
  } catch (error) {
    store.error = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function apply(): void {
  page.value = 1
  void load()
}

function clear(): void {
  Object.assign(form, emptyForm())
  apply()
}

function go(next: number): void {
  page.value = next
  void load()
}

function open(property: Property): void {
  void router.push(`/properties/${property.id}`)
}

function useMapBounds(): void {
  if (!map) return
  const bounds = map.getBounds()
  form.minLatitude = bounds.getSouth().toFixed(6)
  form.maxLatitude = bounds.getNorth().toFixed(6)
  form.minLongitude = bounds.getWest().toFixed(6)
  form.maxLongitude = bounds.getEast().toFixed(6)
  apply()
}

function renderMarkers(): void {
  if (!map || !markers) return
  markers.clearLayers()
  let first = true
  for (const property of results.value) {
    if (property.latitude == null || property.longitude == null) continue
    const latitude = Number(property.latitude)
    const longitude = Number(property.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    const marker = L.circleMarker([latitude, longitude], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#4f46e5',
      fillOpacity: 0.9
    })
    const popup = document.createElement('div')
    const reference = document.createElement('strong')
    reference.textContent = property.referenceNumber || property.title
    const title = document.createElement('div')
    title.textContent = property.title
    const city = document.createElement('div')
    city.textContent = property.city || ''
    const openButton = document.createElement('button')
    openButton.type = 'button'
    openButton.textContent = store.isArabic ? 'فتح التفاصيل' : 'Open details'
    openButton.style.marginTop = '0.5rem'
    openButton.style.padding = '0.3rem 0.6rem'
    openButton.style.border = '0'
    openButton.style.borderRadius = '6px'
    openButton.style.background = '#4f46e5'
    openButton.style.color = '#fff'
    openButton.style.cursor = 'pointer'
    openButton.addEventListener('click', () => void router.push(`/properties/${property.id}`))
    popup.append(reference, title, city, openButton)
    marker.bindPopup(popup)
    marker.addTo(markers)
    if (first) {
      map.setView([latitude, longitude], 12)
      first = false
    }
  }
  if (first && results.value.length) {
    map.setView([24.7136, 46.6753], 6)
  }
  map.invalidateSize()
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.btn { display: inline-flex; align-items: center; border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; text-decoration: none; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.8rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.76rem; color: #4b5563; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.86rem; min-width: 0; }
.filter-actions { display: flex; align-items: end; gap: 0.5rem; flex-wrap: wrap; }
.results-layout { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 1rem; align-items: start; }
.results { display: flex; flex-direction: column; gap: 0.8rem; max-height: 70vh; overflow-y: auto; padding-inline-end: 0.3rem; }
.results-head { display: flex; justify-content: space-between; font-size: 0.84rem; color: #6b7280; }
.map { height: 70vh; min-height: 420px; border-radius: 12px; border: 1px solid #e5e7eb; z-index: 0; }
.empty { background: #fff; border-radius: 12px; padding: 2rem; text-align: center; color: #6b7280; }
.pager { display: flex; justify-content: center; align-items: center; gap: 0.8rem; font-size: 0.84rem; }
.pager button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 0.3rem 0.8rem; cursor: pointer; }
@media (max-width: 900px) { .results-layout { grid-template-columns: 1fr; } .map { height: 50vh; min-height: 320px; } }
</style>
