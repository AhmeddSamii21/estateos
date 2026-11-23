<template>
  <article class="property-card" @click="emit('select', property)">
    <div class="card-top">
      <span class="badge badge-type">{{ label(property.type) }}</span>
      <span class="badge" :class="`badge-${statusKey(property.status)}`">{{ label(property.status) }}</span>
    </div>
    <h3>{{ property.referenceNumber }} · {{ property.title }}</h3>
    <p class="muted">
      <i class="fas fa-location-dot"></i>
      {{ [property.city, property.state, property.country].filter(Boolean).join(', ') || '—' }}
    </p>
    <div class="facts">
      <span><i class="fas fa-bed"></i> {{ property.bedrooms }}</span>
      <span><i class="fas fa-bath"></i> {{ property.bathrooms }}</span>
      <span><i class="fas fa-ruler-combined"></i> {{ property.area ?? '—' }} {{ property.areaUnit === 'SQ_FT' ? 'ft²' : 'm²' }}</span>
    </div>
    <div class="card-bottom">
      <strong>{{ formatMoney(property.price, property.currency) }}</strong>
      <span v-if="property.featured" class="featured"><i class="fas fa-star"></i></span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { useStore } from '@/stores'
import type { Property } from '@/types'

const props = defineProps<{ property: Property }>()
const emit = defineEmits<{ select: [property: Property] }>()
const store = useStore()

function label(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function statusKey(status: string): string {
  const key = status.toLowerCase()
  return ['available', 'pending', 'reserved', 'sold', 'rented', 'off market'].includes(key)
    ? key.replace(' ', '-')
    : 'default'
}

function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase()
  if (!code) return `${Number(amount || 0).toLocaleString(store.isArabic ? 'ar-SA' : 'en-US')} UNSPECIFIED`
  try {
    return new Intl.NumberFormat(store.isArabic ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0
    }).format(Number(amount))
  } catch {
    return `${amount} ${code}`
  }
}
</script>

<style scoped>
.property-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.1rem;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}
.property-card:hover { box-shadow: 0 8px 20px rgba(15, 23, 42, 0.09); transform: translateY(-2px); }
.card-top { display: flex; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.7rem; }
.badge { font-size: 0.68rem; padding: 0.2rem 0.5rem; border-radius: 999px; background: #f3f4f6; color: #374151; }
.badge-type { background: #e0e7ff; color: #3730a3; }
.badge-available { background: #dcfce7; color: #166534; }
.badge-sold { background: #fee2e2; color: #991b1b; }
.badge-pending, .badge-reserved { background: #fef3c7; color: #92400e; }
h3 { font-size: 0.98rem; margin: 0 0 0.35rem; }
.muted { color: #6b7280; font-size: 0.82rem; margin: 0 0 0.8rem; }
.facts { display: flex; gap: 0.9rem; color: #4b5563; font-size: 0.82rem; flex-wrap: wrap; }
.card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 0.9rem; color: #4338ca; }
.featured { color: #f59e0b; }
</style>
