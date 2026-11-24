<template>
  <div class="bars">
    <div v-for="item in items" :key="item.label" class="bar-row">
      <span class="bar-label">{{ label(item.label) }}</span>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: `${percentage(item.value)}%` }"></div>
      </div>
      <strong>{{ item.value }}</strong>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from '@/stores'

const props = defineProps<{ items: Array<{ label: string; value: number }>; max?: number }>()
const store = useStore()

const VALUE_LABELS: Record<string, string> = {
  AVAILABLE: 'متاحة', UNDER_NEGOTIATION: 'قيد التفاوض', PENDING: 'قيد الانتظار',
  RESERVED: 'محجوزة', SOLD: 'مباعة', RENTED: 'مؤجرة', OFF_MARKET: 'خارج السوق',
  UNAVAILABLE: 'غير متاحة', HOUSE: 'منزل', APARTMENT: 'شقة', CONDO: 'شقة مملوكة',
  TOWNHOUSE: 'منزل متصل', VILLA: 'فيلا', LAND: 'أرض', COMMERCIAL: 'تجاري',
  OPEN: 'مفتوح', IN_PROGRESS: 'قيد التنفيذ', RESOLVED: 'تم حلها', CLOSED: 'مغلق'
}

function label(value: string): string {
  if (store.isArabic && VALUE_LABELS[value]) return VALUE_LABELS[value]
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function percentage(value: number): number {
  const max = props.max ?? Math.max(1, ...props.items.map((item) => item.value))
  return Math.max(0, Math.min(100, (value / max) * 100))
}
</script>

<style scoped>
.bars { display: flex; flex-direction: column; gap: 0.55rem; }
.bar-row { display: grid; grid-template-columns: 140px 1fr 45px; gap: 0.6rem; align-items: center; font-size: 0.82rem; }
.bar-label { color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { background: #eef2ff; border-radius: 999px; height: 9px; overflow: hidden; }
.bar-fill { height: 100%; background: #4f46e5; border-radius: 999px; }
.bar-row strong { text-align: end; color: #312e81; }
@media (max-width: 600px) { .bar-row { grid-template-columns: 100px 1fr 35px; } }
</style>
