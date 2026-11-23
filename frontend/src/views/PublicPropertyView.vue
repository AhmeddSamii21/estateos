<template>
  <div class="public-page">
    <header class="public-head">
      <span class="badge">{{ property?.referenceNumber || 'EstateOS' }}</span>
      <h1>{{ store.isArabic ? 'عقار للبيع' : 'Property listing' }}</h1>
    </header>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="error" class="state error" role="alert">
      <h2>{{ store.isArabic ? 'الرابط غير متاح' : 'Link unavailable' }}</h2>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="property">
      <section class="hero">
        <div>
          <h2>{{ property.title }}</h2>
          <p class="location">
            <i class="fas fa-location-dot"></i>
            {{ [property.address, property.city, property.state, property.country].filter(Boolean).join(', ') || '—' }}
          </p>
          <p class="tags">
            <span class="tag">{{ label(property.classification) }}</span>
            <span class="tag">{{ label(property.type) }}</span>
            <span class="tag">{{ label(property.status) }}</span>
            <span v-if="property.negotiable" class="tag">{{ store.isArabic ? 'قابل للتفاوض' : 'Negotiable' }}</span>
          </p>
        </div>
        <strong class="price">{{ money(property.price, property.currency) }}</strong>
      </section>

      <section v-if="gallery.length" class="card">
        <h3>{{ store.isArabic ? 'الصور' : 'Gallery' }}</h3>
        <div class="gallery">
          <figure v-for="image in gallery" :key="image.id">
            <img :src="image.contentUrl" :alt="image.caption || image.originalName || property.title" loading="lazy" />
            <figcaption v-if="image.caption">{{ image.caption }}</figcaption>
          </figure>
        </div>
      </section>

      <section class="card">
        <h3>{{ store.isArabic ? 'المواصفات' : 'Specifications' }}</h3>
        <dl class="facts">
          <div><dt>{{ store.isArabic ? 'غرف النوم' : 'Bedrooms' }}</dt><dd>{{ property.bedrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الحمامات' : 'Bathrooms' }}</dt><dd>{{ property.bathrooms }}</dd></div>
          <div><dt>{{ store.isArabic ? 'المساحة' : 'Area' }}</dt><dd>{{ property.area ?? '—' }} {{ property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الطوابق' : 'Floors' }}</dt><dd>{{ property.floors ?? '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'سنة البناء' : 'Year built' }}</dt><dd>{{ property.yearBuilt ?? '—' }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الحالة' : 'Condition' }}</dt><dd>{{ label(property.condition) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'متاح من' : 'Available from' }}</dt><dd>{{ formatDate(property.availableFrom) }}</dd></div>
          <div><dt>{{ store.isArabic ? 'الرمز البريدي' : 'Postal code' }}</dt><dd>{{ property.postalCode || '—' }}</dd></div>
        </dl>
      </section>

      <section v-if="property.description" class="card">
        <h3>{{ store.isArabic ? 'الوصف' : 'Description' }}</h3>
        <p class="description">{{ property.description }}</p>
      </section>

      <section v-if="hasCoordinates" class="card">
        <h3>{{ store.isArabic ? 'الموقع' : 'Location' }}</h3>
        <div ref="mapElement" class="map" aria-label="Property location"></div>
      </section>

      <footer class="public-foot">
        <span>{{ store.isArabic ? 'هذه الصفحة للعرض فقط.' : 'This page is for viewing only.' }}</span>
        <small v-if="property.shareExpiresAt">{{ store.isArabic ? 'تنتهي في' : 'Expires' }}: {{ formatDate(property.shareExpiresAt) }}</small>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '@/stores'
import type { PublicProperty } from '@/types'

const route = useRoute()
const store = useStore()
const property = ref<PublicProperty | null>(null)
const loading = ref(true)
const error = ref('')
const mapElement = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null

const token = computed(() => String(route.params.shareToken || ''))
const hasCoordinates = computed(() => {
  const lat = Number(property.value?.latitude)
  const lng = Number(property.value?.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
})
const gallery = computed(() => [...(property.value?.images || [])].sort((a, b) => a.sortOrder - b.sortOrder))

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/public/properties/${encodeURIComponent(token.value)}`)
    if (!response.ok) throw new Error(store.isArabic ? 'الرابط غير صالح أو منتهي الصلاحية.' : 'This link is invalid or has expired.')
    const body = await response.json() as { success?: boolean; data?: PublicProperty; error?: { message?: string } }
    if (!body.success || !body.data) throw new Error(body.error?.message || 'Link unavailable')
    property.value = body.data
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Link unavailable'
  } finally {
    loading.value = false
  }
}

watch([property, mapElement, hasCoordinates], () => {
  if (!property.value || !mapElement.value || !hasCoordinates.value || map) return
  const lat = Number(property.value.latitude)
  const lng = Number(property.value.longitude)
  map = L.map(mapElement.value, { center: [lat, lng], zoom: 14, scrollWheelZoom: false })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map)
  L.marker([lat, lng]).addTo(map).bindPopup(property.value.title || property.value.referenceNumber)
}, { flush: 'post' })

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

function label(value: string | null | undefined): string {
  return value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) : '—'
}

function money(amount: string | number, currency: string): string {
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', { style: 'currency', currency }).format(Number(amount))
  } catch {
    return `${amount} ${currency}`
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<style scoped>
.public-page { max-width: 1000px; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
.public-head h1 { font-size: 1.4rem; margin: 0.3rem 0 0; }
.badge { font-size: 0.72rem; color: #3730a3; background: #e0e7ff; padding: 0.2rem 0.6rem; border-radius: 999px; }
.hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.4rem; }
.hero h2 { margin: 0 0 0.4rem; font-size: 1.45rem; }
.location, .muted { color: #6b7280; font-size: 0.86rem; margin: 0; }
.tags { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0.8rem 0 0; }
.tag { font-size: 0.72rem; color: #4338ca; background: #eef2ff; border-radius: 999px; padding: 0.25rem 0.6rem; }
.price { font-size: 1.6rem; color: #4338ca; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.3rem; }
.card h3 { margin: 0 0 0.9rem; font-size: 1.05rem; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.8rem; }
.gallery figure { margin: 0; }
.gallery img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; background: #eef2ff; }
.gallery figcaption { font-size: 0.76rem; color: #6b7280; padding-top: 0.3rem; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.9rem; margin: 0; }
.facts dt { font-size: 0.75rem; color: #6b7280; }
.facts dd { margin: 0.2rem 0 0; font-weight: 600; font-size: 0.92rem; }
.description { line-height: 1.7; color: #374151; white-space: pre-wrap; }
.map { height: 380px; border-radius: 10px; border: 1px solid #e5e7eb; z-index: 0; }
.state { padding: 3rem; text-align: center; background: #fff; border-radius: 12px; color: #6b7280; }
.state.error { color: #991b1b; }
.public-foot { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; color: #6b7280; font-size: 0.78rem; }
</style>
