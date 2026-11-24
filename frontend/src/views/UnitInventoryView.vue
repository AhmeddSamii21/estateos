<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'شبكة مخزون الوحدات' : 'Visual unit inventory' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'توزيع الوحدات حسب المشروع والمبنى والدور مع حالة بصرية واضحة.'
            : 'Units grouped by project, building and floor with an at-a-glance status.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <select v-model="project" :aria-label="store.isArabic ? 'المشروع' : 'Project'">
          <option value="">{{ store.isArabic ? 'كل المشاريع' : 'All projects' }}</option>
          <option v-for="item in projects" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="status" :aria-label="store.isArabic ? 'الحالة' : 'Status'">
          <option value="">{{ store.isArabic ? 'كل الحالات' : 'All statuses' }}</option>
          <option v-for="legend in grid?.legend || []" :key="legend.key" :value="legend.key">{{ legend.label }}</option>
        </select>
        <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
          <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <template v-else-if="grid">
      <section class="legend" :aria-label="store.isArabic ? 'دليل الحالات' : 'Status legend'">
        <span v-for="legend in grid.legend" :key="legend.key" class="legend-item">
          <i :style="{ background: legend.color }"></i>{{ legend.label }}
          <strong>{{ grid.counts[legend.key] || 0 }}</strong>
        </span>
        <span class="legend-total">{{ grid.total }} {{ store.isArabic ? 'وحدة' : 'units' }}</span>
      </section>

      <section v-for="group in grid.groups" :key="`${group.project}-${group.building}`" class="panel group">
        <header class="group-head">
          <h2>{{ group.project }}</h2>
          <span>{{ group.building }}</span>
        </header>
        <div v-for="floor in group.floors" :key="floor.floor" class="floor-row">
          <span class="floor-label">{{ floor.label }}</span>
          <div class="units">
            <button
              v-for="unit in floor.units"
              :key="unit.id"
              type="button"
              class="unit-cell"
              :style="{ '--unit-color': unit.color }"
              :title="`${unit.label} — ${unitStatusLabel(unit.status, store.isArabic ? 'ar' : 'en')} — ${unit.price} ${unit.currency}`"
              @click="selected = unit"
            >
              <strong>{{ unit.label }}</strong>
              <small>{{ unit.bedrooms ? `${unit.bedrooms} BR` : unit.type }}</small>
            </button>
          </div>
        </div>
      </section>

      <div v-if="!grid.groups.length" class="state">
        {{ store.isArabic ? 'لا توجد وحدات مطابقة.' : 'No units match this view.' }}
      </div>
    </template>

    <div v-if="selected" class="drawer-backdrop" @click.self="selected = null">
      <aside class="drawer" :dir="store.direction" role="dialog" aria-modal="true">
        <button class="drawer-close" type="button" aria-label="Close" @click="selected = null">×</button>
        <h2>{{ selected.label }}</h2>
        <p class="muted">{{ selected.title }}</p>
        <dl>
          <dt>{{ store.isArabic ? 'الحالة' : 'Status' }}</dt>
          <dd>{{ unitStatusLabel(selected.status, store.isArabic ? 'ar' : 'en') }}</dd>
          <dt>{{ store.isArabic ? 'السعر' : 'Price' }}</dt>
          <dd>{{ selected.price }} {{ selected.currency }}</dd>
          <dt>{{ store.isArabic ? 'الغرف' : 'Bedrooms' }}</dt>
          <dd>{{ selected.bedrooms }}</dd>
        </dl>
        <label v-if="canManage">
          <span>{{ store.isArabic ? 'رقم الوحدة' : 'Unit number' }}</span>
          <input v-model="unitNumber" maxlength="40" />
        </label>
        <button v-if="canManage" class="btn btn-primary" type="button" :disabled="saving" @click="saveUnit">
          {{ saving ? '…' : (store.isArabic ? 'حفظ' : 'Save unit') }}
        </button>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiGet, apiPatch, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import { buildUnitGrid, unitStatusLabel } from '@/utils/unitInventoryCore.mjs'

interface Unit {
  id: string
  label: string
  title: string
  status: string
  color: string
  price: number
  currency: string
  bedrooms: number
  type: string
}
interface Grid {
  groups: Array<{ project: string; building: string; floors: Array<{ floor: number; label: string; units: Unit[] }> }>
  counts: Record<string, number>
  total: number
  legend: Array<{ key: string; label: string; color: string }>
}

const store = useStore()
const canManage = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const grid = ref<Grid | null>(null)
const project = ref('')
const status = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const selected = ref<Unit | null>(null)
const unitNumber = ref('')

const projects = computed(() => Array.from(new Set(grid.value?.groups.map((group) => group.project) || [])).sort())

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, string> = {
      language: store.isArabic ? 'ar' : 'en',
      project: project.value,
      status: status.value
    }
    const response = await apiGet<Grid>('/inventory/units', { params })
    grid.value = response.data
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function saveUnit(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  error.value = ''
  try {
    await apiPatch(`/inventory/units/${selected.value.id}`, { unitNumber: unitNumber.value || null })
    selected.value = null
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.legend { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: center; margin-bottom: 1rem; }
.legend-item { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; }
.legend-item i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.legend-total { margin-inline-start: auto; font-weight: 600; }
.group { margin-bottom: 1rem; }
.group-head { display: flex; justify-content: space-between; gap: 0.5rem; align-items: baseline; }
.group-head h2 { margin: 0; font-size: 1.05rem; }
.group-head span { color: var(--muted, #64748b); font-size: 0.85rem; }
.floor-row { display: grid; grid-template-columns: 110px 1fr; gap: 0.7rem; padding: 0.45rem 0; border-top: 1px solid var(--border, #eef2f7); }
.floor-label { font-size: 0.82rem; color: var(--muted, #64748b); }
.units { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.unit-cell { display: grid; gap: 0.1rem; min-width: 84px; padding: 0.45rem 0.6rem; border: 1px solid var(--unit-color); border-left-width: 5px; border-radius: 8px; background: var(--surface, #fff); text-align: start; }
.unit-cell strong { font-size: 0.85rem; }
.unit-cell small { color: var(--muted, #64748b); }
.drawer-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); display: flex; justify-content: flex-end; z-index: 60; }
.drawer { width: min(420px, 100%); height: 100%; background: var(--surface, #fff); padding: 1.5rem; overflow: auto; }
.drawer-close { float: inline-end; border: 0; background: none; font-size: 1.4rem; cursor: pointer; }
.drawer dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 1rem 0; }
.drawer dt { font-weight: 600; }
.drawer dd { margin: 0; }
@media (max-width: 700px) { .floor-row { grid-template-columns: 1fr; } }
</style>
