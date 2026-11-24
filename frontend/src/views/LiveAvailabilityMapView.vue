<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'خريطة التوفر المباشر والمخطط التفاعلي' : 'Live availability map & masterplan' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'أسعار وحالات الوحدات محدّثة مباشرة على الخريطة أو مخطط المشروع، مع تصفية وفحص سريع.'
            : 'Live unit prices and statuses on a geographic map or project masterplan, with filters and fast inspection.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
          <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
        </button>
        <button class="btn btn-quiet" type="button" @click="print">
          <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة' : 'Print' }}
        </button>
      </div>
    </div>

    <form class="filters panel no-print" @submit.prevent="load">
      <label>
        <span>{{ store.isArabic ? 'المشروع' : 'Project' }}</span>
        <select v-model="filters.project" @change="load">
          <option value="">{{ store.isArabic ? 'كل المشاريع' : 'All projects' }}</option>
          <option v-for="name in projectNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
        <select v-model="filters.status" @change="load">
          <option value="">{{ store.isArabic ? 'كل الحالات' : 'All statuses' }}</option>
          <option v-for="legend in result?.legend || mapLegend" :key="legend.key" :value="legend.key">{{ legend.label }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'نوع الوحدة' : 'Unit type' }}</span>
        <select v-model="filters.type" @change="load">
          <option value="">{{ store.isArabic ? 'كل الأنواع' : 'All types' }}</option>
          <option v-for="type in unitTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأدنى للسعر' : 'Min price' }}</span>
        <input v-model="filters.minPrice" type="number" min="0" inputmode="decimal" @change="load" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأعلى للسعر' : 'Max price' }}</span>
        <input v-model="filters.maxPrice" type="number" min="0" inputmode="decimal" @change="load" />
      </label>
      <button class="btn btn-primary" type="submit">{{ store.isArabic ? 'تطبيق' : 'Apply filters' }}</button>
    </form>

    <section class="counters" :aria-label="store.isArabic ? 'ملخص التوفر' : 'Availability summary'">
      <div class="counter">
        <span>{{ store.isArabic ? 'إجمالي الوحدات' : 'Total units' }}</span>
        <strong>{{ result?.totals.units ?? 0 }}</strong>
      </div>
      <div v-for="legend in result?.legend || mapLegend" :key="legend.key" class="counter" :class="`counter-${legend.key.toLowerCase()}`">
        <span><i :style="{ background: legend.color }"></i>{{ legend.label }}</span>
        <strong>{{ result?.counts[legend.key] ?? 0 }}</strong>
      </div>
      <div class="counter">
        <span>{{ store.isArabic ? 'المشاريع' : 'Projects' }}</span>
        <strong>{{ result?.totals.projects ?? 0 }}</strong>
      </div>
    </section>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="notice" class="notice" role="status">{{ notice }}</div>

    <div class="view-switch no-print" role="group" :aria-label="store.isArabic ? 'طريقة العرض' : 'View mode'">
      <button type="button" :aria-pressed="viewMode === 'map'" :class="{ active: viewMode === 'map' }" @click="switchView('map')">
        <i class="fas fa-map-marked-alt"></i> {{ store.isArabic ? 'الخريطة' : 'Map' }}
      </button>
      <button type="button" :aria-pressed="viewMode === 'grid'" :class="{ active: viewMode === 'grid' }" @click="switchView('grid')">
        <i class="fas fa-grip"></i> {{ store.isArabic ? 'شبكة التكديس' : 'Stacking grid' }}
      </button>
      <button type="button" :aria-pressed="viewMode === 'list'" :class="{ active: viewMode === 'list' }" @click="switchView('list')">
        <i class="fas fa-list"></i> {{ store.isArabic ? 'قائمة' : 'List' }}
      </button>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ تحميل الخريطة…' : 'Loading availability map…' }}</div>
    <template v-else-if="result">
      <template v-if="viewMode === 'map'">
        <div class="map-switch no-print" role="group" :aria-label="store.isArabic ? 'طبقة الخريطة' : 'Map layer'">
          <button type="button" :aria-pressed="mapMode === 'geo'" :class="{ active: mapMode === 'geo' }" @click="switchMapMode('geo')">
            {{ store.isArabic ? 'خريطة جغرافية' : 'Geographic map' }}
          </button>
          <button type="button" :aria-pressed="mapMode === 'masterplan'" :class="{ active: mapMode === 'masterplan' }" @click="switchMapMode('masterplan')">
            {{ store.isArabic ? 'مخطط المشروع' : 'Project masterplan' }}
          </button>
        </div>

        <div v-show="mapMode === 'geo'" class="geo-wrap">
          <div ref="mapElement" class="geo-map" :aria-label="store.isArabic ? 'خريطة الوحدات' : 'Units map'"></div>
          <p class="hint">
            {{ store.isArabic ? 'اضغط على أي مؤشر لعرض تفاصيل الوحدة. الخريطة تعمل بأمان مع مزودي البلاط العام.' : 'Select a pin to inspect the unit. Map tiles come from OpenStreetMap.' }}
          </p>
        </div>

        <div v-show="mapMode === 'masterplan'" class="masterplan-panel">
          <div class="masterplan-head no-print">
            <label>
              <span>{{ store.isArabic ? 'المخطط' : 'Masterplan' }}</span>
              <select v-model="activeProjectKey">
                <option v-for="project in result.projects" :key="project.key" :value="project.key">{{ project.name }}</option>
              </select>
            </label>
            <p class="muted">
              {{ store.isArabic
                ? 'ضع المؤشرات على المخطط واضغط على وحدة لفحصها.'
                : 'Pins are placed over the masterplan; select one to inspect it.' }}
            </p>
          </div>
          <div v-if="activeProject" class="masterplan" dir="ltr" @click="onMasterplanClick">
            <img :src="masterplanSrc" :alt="activeProject.name" @error="fallbackImage = true" />
            <button
              v-for="unit in masterplanUnits"
              :key="unit.id"
              type="button"
              class="pin"
              :class="{ selected: selected?.id === unit.id }"
              :style="{ left: `${unit.mapX}%`, top: `${unit.mapY}%`, background: unit.color }"
              :title="pinTooltip(unit)"
              :aria-label="pinTooltip(unit)"
              @click.stop="openUnit(unit)"
            >
              <span class="pin-dot"></span>
              <span class="pin-label">{{ unit.label }}</span>
            </button>
            <p v-if="!masterplanUnits.length" class="masterplan-empty">
              {{ store.isArabic ? 'لا توجد وحدات بمواقع على المخطط لهذا المشروع.' : 'No masterplan pins for this project.' }}
            </p>
          </div>
          <div v-else class="state">{{ store.isArabic ? 'لا توجد مشاريع مطابقة.' : 'No matching projects.' }}</div>
          <p v-if="canCoordinate && selected" class="hint no-print">
            {{ store.isArabic ? 'اضغط على المخطط لتحريك مؤشر الوحدة المحددة.' : 'Click the masterplan to move the selected unit pin.' }}
          </p>
        </div>
      </template>

      <section v-else-if="viewMode === 'grid'" class="stacking-grid">
        <article v-for="group in gridGroups" :key="group.key" class="panel stack-group">
          <header class="stack-head">
            <h2>{{ group.project }}</h2>
            <span>{{ group.building }}</span>
          </header>
          <div class="stack-row">
            <span class="stack-floor">{{ floorLabel(group.floor) }}</span>
            <div class="stack-units">
              <button
                v-for="unit in group.units"
                :key="unit.id"
                type="button"
                class="stack-cell"
                :style="{ '--pin-color': unit.color }"
                :title="pinTooltip(unit)"
                @click="openUnit(unit)"
              >
                <strong>{{ unit.label }}</strong>
                <small>{{ formatMoney(unit.price, unit.currency) }}</small>
              </button>
            </div>
          </div>
        </article>
        <div v-if="!gridGroups.length" class="state">{{ store.isArabic ? 'لا توجد وحدات مطابقة.' : 'No units match these filters.' }}</div>
      </section>

      <section v-else class="panel list-wrap">
        <div class="table-scroll">
          <table class="unit-table">
            <thead>
              <tr>
                <th scope="col">{{ store.isArabic ? 'الوحدة' : 'Unit' }}</th>
                <th scope="col">{{ store.isArabic ? 'المشروع' : 'Project' }}</th>
                <th scope="col">{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
                <th scope="col">{{ store.isArabic ? 'السعر' : 'Price' }}</th>
                <th scope="col">{{ store.isArabic ? 'المساحة' : 'Area' }}</th>
                <th scope="col">{{ store.isArabic ? 'الدور' : 'Floor' }}</th>
                <th scope="col"><span class="sr-only">{{ store.isArabic ? 'فحص' : 'Inspect' }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="unit in result.units" :key="unit.id">
                <td><strong>{{ unit.label }}</strong><small class="muted">{{ unit.title }}</small></td>
                <td>{{ unit.project }}<small class="muted">{{ unit.building }}</small></td>
                <td><span class="status-pill" :style="{ background: unit.color }">{{ mapStatusLabel(unit.status, store.isArabic ? 'ar' : 'en') }}</span></td>
                <td>{{ formatMoney(unit.price, unit.currency) }}</td>
                <td>{{ unit.area }} {{ store.isArabic ? 'م²' : 'm²' }}</td>
                <td>{{ floorLabel(unit.floor) }}</td>
                <td><button class="btn btn-quiet" type="button" @click="openUnit(unit)">{{ store.isArabic ? 'فحص' : 'Inspect' }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <div v-if="selected" class="drawer-backdrop no-print" @click.self="closeDrawer">
      <aside class="drawer" :dir="store.direction" role="dialog" aria-modal="true" :aria-label="selected.label">
        <button class="drawer-close" type="button" :aria-label="store.isArabic ? 'إغلاق' : 'Close'" @click="closeDrawer">×</button>
        <h2>{{ selected.label }}</h2>
        <p class="muted">{{ selected.title }}</p>
        <dl>
          <dt>{{ store.isArabic ? 'المشروع' : 'Project' }}</dt>
          <dd>{{ selected.project }}</dd>
          <dt>{{ store.isArabic ? 'المبنى' : 'Building' }}</dt>
          <dd>{{ selected.building }}</dd>
          <dt>{{ store.isArabic ? 'الحالة' : 'Status' }}</dt>
          <dd><span class="status-pill" :style="{ background: selected.color }">{{ rawStatusLabel(selected.rawStatus) }}</span></dd>
          <dt>{{ store.isArabic ? 'السعر' : 'Price' }}</dt>
          <dd><strong>{{ formatMoney(selected.price, selected.currency) }}</strong></dd>
          <dt>{{ store.isArabic ? 'المساحة' : 'Area' }}</dt>
          <dd>{{ selected.area }} {{ store.isArabic ? 'م²' : 'm²' }}</dd>
          <dt>{{ store.isArabic ? 'الدور' : 'Floor' }}</dt>
          <dd>{{ floorLabel(selected.floor) }}</dd>
          <dt>{{ store.isArabic ? 'النوع' : 'Type' }}</dt>
          <dd>{{ selected.type }}</dd>
          <dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt>
          <dd>{{ selected.bedrooms }}</dd>
        </dl>

        <section v-if="canUpdateStatus" class="drawer-section">
          <h3>{{ store.isArabic ? 'تحديث سريع للحالة' : 'Quick status update' }}</h3>
          <div class="status-actions">
            <button
              v-for="status in quickStatuses"
              :key="status"
              class="btn btn-quiet"
              type="button"
              :disabled="saving"
              @click="setStatus(status)"
            >
              {{ mapStatusLabel(status, store.isArabic ? 'ar' : 'en') }}
            </button>
          </div>
          <p v-if="!quickStatuses.length" class="muted small">
            {{ store.isArabic ? 'لا يمكن تغيير حالة هذه الوحدة.' : 'This unit status cannot be changed further.' }}
          </p>
        </section>

        <section v-if="canCoordinate" class="drawer-section">
          <h3>{{ store.isArabic ? 'موقع المؤشر' : 'Pin position' }}</h3>
          <div class="coordinate-grid">
            <label>
              <span>X %</span>
              <input v-model.number="coordinates.mapX" type="number" min="0" max="100" step="0.1" />
            </label>
            <label>
              <span>Y %</span>
              <input v-model.number="coordinates.mapY" type="number" min="0" max="100" step="0.1" />
            </label>
          </div>
          <button class="btn btn-quiet" type="button" :disabled="saving" @click="saveCoordinates">
            {{ saving ? '…' : (store.isArabic ? 'حفظ الموقع' : 'Save position') }}
          </button>
        </section>

        <div class="drawer-links">
          <button class="btn btn-primary" type="button" @click="openSimulator">
            <i class="fas fa-calculator"></i> {{ store.isArabic ? 'محاكاة الأقساط' : 'Installment simulator' }}
          </button>
          <button class="btn btn-quiet" type="button" @click="addToComparison">
            <i class="fas fa-code-compare"></i> {{ store.isArabic ? 'أضف للمقارنة' : 'Add to comparison' }}
          </button>
          <router-link class="btn btn-quiet" :to="`/properties/${selected.id}`">
            {{ store.isArabic ? 'تفاصيل العقار' : 'Property details' }}
          </router-link>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiGet, apiPatch, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import {
  MAP_STATUS_META,
  masterplanDataUrl,
  mapStatusLabel,
  type AvailabilityMapResult,
  type MapPin
} from '@/utils/liveMapCore.mjs'

const store = useStore()
const router = useRouter()

type ViewMode = 'map' | 'grid' | 'list'
type MapMode = 'geo' | 'masterplan'

const result = ref<AvailabilityMapResult | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const viewMode = ref<ViewMode>('map')
const mapMode = ref<MapMode>('geo')
const filters = ref({ project: '', status: '', type: '', minPrice: '', maxPrice: '' })
const selected = ref<MapPin | null>(null)
const activeProjectKey = ref('')
const fallbackImage = ref(false)
const coordinates = ref({ mapX: 0, mapY: 0 })
const mapElement = ref<HTMLDivElement | null>(null)

const mapLegend = [
  { key: 'AVAILABLE', label: store.isArabic ? 'متاح' : 'Available', color: MAP_STATUS_META.AVAILABLE.color },
  { key: 'RESERVED', label: store.isArabic ? 'محجوز' : 'Reserved', color: MAP_STATUS_META.RESERVED.color },
  { key: 'SOLD', label: store.isArabic ? 'مباع' : 'Sold', color: MAP_STATUS_META.SOLD.color }
]

const canManage = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const canCoordinate = computed(() => canManage.value || store.user?.role === 'TEAM_LEAD')
const canUpdateStatus = computed(() => canManage.value || store.user?.role === 'TEAM_LEAD' || store.user?.role === 'AGENT')
const projectNames = computed(() => result.value?.projects.map((project) => project.name) || [])
const unitTypes = computed(() => Array.from(new Set(result.value?.units.map((unit) => unit.type) || [])).sort())
const activeProject = computed(() => result.value?.projects.find((project) => project.key === activeProjectKey.value) || null)
const masterplanUnits = computed(() => activeProject.value?.units.filter((unit) => unit.hasMasterplanPin) || [])

const masterplanSrc = computed(() => {
  const project = activeProject.value
  if (!project) return ''
  if (fallbackImage.value || !project.masterplanImageUrl) {
    return masterplanDataUrl(project.name, store.isArabic ? 'ar' : 'en')
  }
  const url = project.masterplanImageUrl
  if (/^(data:|https?:)/i.test(url)) return url
  return `${import.meta.env.BASE_URL}${url.replace(/^\/+/, '')}`
})

interface GridGroup { key: string; project: string; building: string; floor: number; units: MapPin[] }
const gridGroups = computed<GridGroup[]>(() => {
  const groups = new Map<string, GridGroup>()
  for (const unit of result.value?.units || []) {
    const key = `${unit.project}|${unit.building}|${unit.floor}`
    if (!groups.has(key)) groups.set(key, { key, project: unit.project, building: unit.building, floor: unit.floor, units: [] })
    groups.get(key)!.units.push(unit)
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
})

const TRANSITIONS: Record<string, string[]> = {
  AVAILABLE: ['RESERVED', 'SOLD'],
  PENDING: ['AVAILABLE', 'RESERVED', 'SOLD'],
  UNDER_NEGOTIATION: ['AVAILABLE', 'RESERVED', 'SOLD'],
  RESERVED: ['AVAILABLE', 'SOLD'],
  RENTED: ['AVAILABLE'],
  OFF_MARKET: ['AVAILABLE'],
  UNAVAILABLE: ['AVAILABLE'],
  SOLD: []
}
const quickStatuses = computed(() => TRANSITIONS[selected.value?.rawStatus || ''] || [])

const RAW_STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  AVAILABLE: { en: 'Available', ar: 'متاح' },
  PENDING: { en: 'Pending', ar: 'قيد الانتظار' },
  UNDER_NEGOTIATION: { en: 'Under negotiation', ar: 'قيد التفاوض' },
  RESERVED: { en: 'Reserved', ar: 'محجوز' },
  SOLD: { en: 'Sold', ar: 'مباع' },
  RENTED: { en: 'Rented', ar: 'مؤجر' },
  OFF_MARKET: { en: 'Off market', ar: 'خارج السوق' },
  UNAVAILABLE: { en: 'Unavailable', ar: 'غير متاح' }
}

let map: L.Map | null = null
let markers: L.LayerGroup | null = null
let fitOnNextRender = true
const markersById = new Map<string, L.CircleMarker>()

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }).format(Number(value) || 0) + ` ${currency}`
  } catch {
    return `${value} ${currency}`
  }
}

function floorLabel(floor: number): string {
  if (store.isArabic) return floor === 0 ? 'الأرضي' : `الدور ${floor}`
  return floor === 0 ? 'Ground floor' : `Floor ${floor}`
}

function rawStatusLabel(status: string): string {
  const meta = RAW_STATUS_LABELS[status]
  return meta ? meta[store.isArabic ? 'ar' : 'en'] : status || '—'
}

function pinTooltip(unit: MapPin): string {
  return `${unit.label} — ${mapStatusLabel(unit.status, store.isArabic ? 'ar' : 'en')} — ${formatMoney(unit.price, unit.currency)}`
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await apiGet<AvailabilityMapResult>('/maps/availability', {
      params: {
        language: store.isArabic ? 'ar' : 'en',
        project: filters.value.project,
        status: filters.value.status,
        type: filters.value.type,
        minPrice: filters.value.minPrice,
        maxPrice: filters.value.maxPrice
      }
    })
    result.value = response.data
    if (!result.value.projects.some((project) => project.key === activeProjectKey.value)) {
      activeProjectKey.value = result.value.projects[0]?.key || ''
    }
    fallbackImage.value = false
    fitOnNextRender = true
    await nextTick()
    renderMarkers()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function switchView(mode: ViewMode): void {
  viewMode.value = mode
  if (mode === 'map' && mapMode.value === 'geo') {
    void nextTick(() => { map?.invalidateSize(); renderMarkers() })
  }
}

function switchMapMode(mode: MapMode): void {
  mapMode.value = mode
  if (mode === 'geo') {
    void nextTick(() => { map?.invalidateSize(); renderMarkers() })
  }
}

function setupMap(): void {
  if (map || !mapElement.value) return
  map = L.map(mapElement.value, { center: [26.5, 31.2], zoom: 6, zoomControl: true })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map)
  markers = L.layerGroup().addTo(map)
  renderMarkers()
}

function renderMarkers(): void {
  if (!map || !markers) return
  markers.clearLayers()
  markersById.clear()
  const units = (result.value?.units || []).filter((unit) => unit.hasGeoPin && unit.latitude !== null && unit.longitude !== null)
  const bounds: Array<[number, number]> = []
  for (const unit of units) {
    const position: [number, number] = [unit.latitude as number, unit.longitude as number]
    bounds.push(position)
    const marker = L.circleMarker(position, {
      radius: 8,
      color: '#ffffff',
      weight: 2,
      fillColor: unit.color,
      fillOpacity: 0.92
    }).addTo(markers)
    const popup = `<div dir="${store.isArabic ? 'rtl' : 'ltr'}" class="map-popup"><strong>${escapeHtml(unit.label)}</strong><br>${escapeHtml(unit.project)}<br>${escapeHtml(pinTooltip(unit))}<br><button type="button" class="map-popup-inspect">${escapeHtml(store.isArabic ? 'فحص الوحدة' : 'Inspect unit')}</button></div>`
    marker.bindPopup(popup)
    marker.on('popupopen', () => {
      const element = marker.getPopup()?.getElement()
      element?.querySelector('.map-popup-inspect')?.addEventListener('click', () => openUnit(unit))
    })
    markersById.set(unit.id, marker)
  }
  highlightSelected()
  if (fitOnNextRender && bounds.length) {
    map.fitBounds(L.latLngBounds(bounds).pad(0.18))
    fitOnNextRender = false
  }
}

function highlightSelected(): void {
  for (const [id, marker] of markersById) {
    marker.setStyle({ weight: selected.value?.id === id ? 4 : 2, radius: selected.value?.id === id ? 11 : 8 })
  }
}

function openUnit(unit: MapPin): void {
  selected.value = unit
  coordinates.value = { mapX: unit.mapX ?? 50, mapY: unit.mapY ?? 50 }
  highlightSelected()
}

function closeDrawer(): void {
  selected.value = null
  highlightSelected()
}

async function setStatus(status: string): Promise<void> {
  if (!selected.value || saving.value) return
  const unit = selected.value
  const previous = unit.status
  saving.value = true
  error.value = ''
  notice.value = ''
  selected.value = {
    ...unit,
    status: status as MapPin['status'],
    rawStatus: status,
    color: MAP_STATUS_META[status as keyof typeof MAP_STATUS_META].color
  }
  try {
    await apiPatch(`/properties/${unit.id}/status`, { status })
    await load()
    notice.value = store.isArabic ? 'تم تحديث الحالة على الخريطة فورًا.' : 'Status updated on the map instantly.'
  } catch (caught) {
    selected.value = { ...unit, status: previous, rawStatus: unit.rawStatus, color: unit.color }
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function saveCoordinates(): Promise<void> {
  if (!selected.value || saving.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = await apiPatch(`/properties/${selected.value.id}/coordinates`, {
      mapX: Math.min(100, Math.max(0, Number(coordinates.value.mapX) || 0)),
      mapY: Math.min(100, Math.max(0, Number(coordinates.value.mapY) || 0))
    })
    const id = selected.value.id
    await load()
    selected.value = result.value?.units.find((unit) => unit.id === id) || null
    notice.value = store.isArabic ? 'تم حفظ موقع المؤشر.' : 'Pin position saved.'
    void saved
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

function onMasterplanClick(event: MouseEvent): void {
  if (!canCoordinate.value || !selected.value) return
  const container = event.currentTarget as HTMLElement
  const rect = container.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  coordinates.value = {
    mapX: Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(2)),
    mapY: Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(2))
  }
  void saveCoordinates()
}

function openSimulator(): void {
  if (!selected.value) return
  void router.push({
    path: '/finance/payment-calculator',
    query: { price: String(selected.value.price), currency: selected.value.currency, property: selected.value.id }
  })
}

function addToComparison(): void {
  if (!selected.value) return
  void router.push({ path: '/properties', query: { compare: selected.value.id } })
}

function print(): void {
  window.print()
}

watch(() => result.value, () => { fitOnNextRender = true; void nextTick(renderMarkers) })
watch(activeProjectKey, () => { fallbackImage.value = false })

onMounted(() => {
  void load().then(() => { void nextTick(setupMap) })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
  markers = null
})
</script>

<style scoped>
.page { display: grid; gap: 1rem; }
.page-head { display: flex; flex-wrap: wrap; gap: 1rem; align-items: start; justify-content: space-between; }
.page-head h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
.head-actions, .view-switch, .map-switch, .status-actions, .drawer-links { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; align-items: end; }
.filters label { display: grid; gap: 0.25rem; font-size: 0.82rem; }
.filters input, .filters select, .coordinate-grid input { width: 100%; padding: 0.5rem; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; background: var(--surface, #fff); color: inherit; }
.counters { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.counter { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem 1rem; border: 1px solid var(--border, #e2e8f0); border-radius: 10px; background: var(--surface, #fff); }
.counter span { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--muted, #64748b); }
.counter i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.counter strong { font-size: 1.35rem; }
.view-switch button, .map-switch button { padding: 0.5rem 0.9rem; border: 1px solid var(--border, #e2e8f0); border-radius: 999px; background: var(--surface, #fff); cursor: pointer; }
.view-switch button.active, .map-switch button.active { background: var(--primary, #0f766e); border-color: var(--primary, #0f766e); color: #fff; }
.geo-wrap { display: grid; gap: 0.4rem; }
.geo-map { height: min(62vh, 560px); min-height: 340px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border, #e2e8f0); background-color: #e8f1e9; background-image: linear-gradient(#d6e6d8 1px, transparent 1px), linear-gradient(90deg, #d6e6d8 1px, transparent 1px); background-size: 32px 32px; }
.hint { margin: 0; font-size: 0.78rem; color: var(--muted, #64748b); }
.masterplan-panel { display: grid; gap: 0.75rem; }
.masterplan-head { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end; }
.masterplan-head label { display: grid; gap: 0.25rem; font-size: 0.82rem; }
.masterplan-head select { padding: 0.5rem; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; background: var(--surface, #fff); color: inherit; }
.masterplan { position: relative; width: 100%; aspect-ratio: 10 / 7; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; overflow: hidden; background: #eef2ff; }
.masterplan img { width: 100%; height: 100%; object-fit: fill; display: block; }
.pin { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.45rem; border: 2px solid #fff; border-radius: 999px; color: #fff; font-size: 0.72rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3); }
.pin.selected { outline: 3px solid #0f172a; z-index: 3; }
.pin-dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; }
.pin-label { white-space: nowrap; }
.masterplan-empty { position: absolute; inset-inline: 0; top: 45%; text-align: center; color: var(--muted, #64748b); }
.stacking-grid { display: grid; gap: 0.75rem; }
.stack-group { padding: 0.9rem; }
.stack-head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; justify-content: space-between; }
.stack-head h2 { margin: 0; font-size: 1rem; }
.stack-head span { color: var(--muted, #64748b); font-size: 0.82rem; }
.stack-row { display: grid; grid-template-columns: 110px 1fr; gap: 0.75rem; padding-top: 0.6rem; }
.stack-floor { font-size: 0.82rem; color: var(--muted, #64748b); }
.stack-units { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.stack-cell { display: grid; gap: 0.15rem; min-width: 92px; padding: 0.45rem 0.6rem; border: 1px solid var(--pin-color); border-inline-start-width: 5px; border-radius: 8px; background: var(--surface, #fff); text-align: start; cursor: pointer; }
.stack-cell small { color: var(--muted, #64748b); font-size: 0.72rem; }
.list-wrap { padding: 0; overflow: hidden; }
.table-scroll { overflow-x: auto; }
.unit-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.unit-table th, .unit-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border, #eef2f7); text-align: start; vertical-align: middle; }
.unit-table th { background: rgba(15, 118, 110, 0.06); font-size: 0.78rem; }
.unit-table small { display: block; font-size: 0.72rem; }
.status-pill { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; color: #fff; font-size: 0.75rem; font-weight: 600; }
.drawer-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; background: rgba(15, 23, 42, 0.42); }
.drawer { position: relative; width: min(440px, 100%); height: 100%; padding: 1.5rem; overflow: auto; background: var(--surface, #fff); box-shadow: -8px 0 24px rgba(15, 23, 42, 0.15); }
.drawer-close { float: inline-end; border: 0; background: none; font-size: 1.5rem; cursor: pointer; }
.drawer h2 { margin: 0; font-size: 1.3rem; }
.drawer dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin: 1rem 0; }
.drawer dt { font-size: 0.78rem; color: var(--muted, #64748b); }
.drawer dd { margin: 0; font-weight: 600; }
.drawer-section { padding: 0.8rem 0; border-top: 1px solid var(--border, #eef2f7); }
.drawer-section h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
.coordinate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem; }
.coordinate-grid label { display: grid; gap: 0.25rem; font-size: 0.78rem; }
.drawer-links { flex-direction: column; align-items: stretch; margin-top: 0.8rem; }
.drawer-links .btn { text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 720px) {
  .page-head { flex-direction: column; }
  .stack-row { grid-template-columns: 1fr; }
  .filters { grid-template-columns: 1fr 1fr; }
  .geo-map { height: 420px; min-height: 300px; }
}
@media print {
  .no-print, .geo-wrap, .masterplan-panel { display: none !important; }
  .page { display: block; }
  .unit-table { font-size: 0.72rem; }
  .drawer-backdrop { position: static; background: none; }
  .drawer { width: 100%; box-shadow: none; }
}
</style>
