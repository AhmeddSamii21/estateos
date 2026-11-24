<template>
  <form class="filters" @submit.prevent="onApply">
    <div class="grid">
      <label>
        <span>{{ store.isArabic ? 'بحث' : 'Search' }}</span>
        <input v-model="form.search" type="search" :placeholder="store.isArabic ? 'العنوان أو الرقم المرجعي' : 'Title or reference'" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'المدينة' : 'City' }}</span>
        <input v-model="form.city" type="text" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'النوع' : 'Type' }}</span>
        <select v-model="form.type">
          <option value="">—</option>
          <option v-for="option in types" :key="option" :value="option">{{ optionLabel(option) }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحالة' : 'Status' }}</span>
        <select v-model="form.status">
          <option value="">—</option>
          <option v-for="option in statuses" :key="option" :value="option">{{ optionLabel(option) }}</option>
        </select>
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأدنى' : 'Min price' }}</span>
        <input v-model="form.minPrice" type="number" min="0" />
      </label>
      <label>
        <span>{{ store.isArabic ? 'الحد الأعلى' : 'Max price' }}</span>
        <input v-model="form.maxPrice" type="number" min="0" />
      </label>
    </div>
    <div class="actions">
      <button class="btn btn-primary" type="submit">
        <i class="fas fa-magnifying-glass"></i> {{ store.isArabic ? 'تطبيق' : 'Apply' }}
      </button>
      <button class="btn btn-quiet" type="button" @click="onClear">
        <i class="fas fa-rotate-left"></i> {{ store.isArabic ? 'مسح' : 'Clear' }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useStore } from '@/stores'
import type { PropertyFilters } from '@/types'

const emit = defineEmits<{ apply: [filters: PropertyFilters]; clear: [] }>()
const store = useStore()

const form = reactive({
  search: '',
  city: '',
  type: '',
  status: '',
  minPrice: '',
  maxPrice: ''
})

const types = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'VILLA', 'LAND', 'COMMERCIAL']
const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET', 'UNAVAILABLE']

const OPTION_LABELS: Record<string, [string, string]> = {
  HOUSE: ['House', 'منزل'],
  APARTMENT: ['Apartment', 'شقة'],
  CONDO: ['Condo', 'شقة مملوكة'],
  TOWNHOUSE: ['Townhouse', 'منزل متصل'],
  VILLA: ['Villa', 'فيلا'],
  LAND: ['Land', 'أرض'],
  COMMERCIAL: ['Commercial', 'تجاري'],
  AVAILABLE: ['Available', 'متاحة'],
  UNDER_NEGOTIATION: ['Under negotiation', 'قيد التفاوض'],
  PENDING: ['Pending', 'قيد الانتظار'],
  RESERVED: ['Reserved', 'محجوزة'],
  SOLD: ['Sold', 'مباعة'],
  RENTED: ['Rented', 'مؤجرة'],
  OFF_MARKET: ['Off market', 'خارج السوق'],
  UNAVAILABLE: ['Unavailable', 'غير متاحة']
}

function optionLabel(value: string): string {
  const pair = OPTION_LABELS[value]
  return store.isArabic && pair ? pair[1] : (pair ? pair[0] : value)
}

function onApply(): void {
  emit('apply', { ...form })
}

function onClear(): void {
  Object.assign(form, { search: '', city: '', type: '', status: '', minPrice: '', maxPrice: '' })
  emit('clear')
}
</script>

<style scoped>
.filters { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem 1.2rem; margin-bottom: 1.2rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: #4b5563; }
input, select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.5rem 0.6rem; font-size: 0.88rem; min-width: 0; }
.actions { display: flex; gap: 0.6rem; margin-top: 0.9rem; }
.btn { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 8px; padding: 0.5rem 0.9rem; cursor: pointer; border: 1px solid transparent; font-size: 0.86rem; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-quiet { background: #f3f4f6; color: #374151; }
</style>
