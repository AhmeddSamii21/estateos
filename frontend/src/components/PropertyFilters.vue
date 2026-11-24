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

    <section class="presets" :aria-label="store.isArabic ? 'مرشحات محفوظة' : 'Saved filter presets'">
      <div class="preset-heading">
        <i class="fas fa-bookmark" aria-hidden="true"></i>
        <strong>{{ store.isArabic ? 'المرشحات المحفوظة' : 'Saved presets' }}</strong>
      </div>
      <div class="preset-save">
        <input
          v-model="presetName"
          type="text"
          :placeholder="store.isArabic ? 'اسم المرشح الجديد' : 'New preset name'"
          :aria-label="store.isArabic ? 'اسم المرشح' : 'Preset name'"
        />
        <button class="btn btn-quiet" type="button" @click="onSavePreset">
          <i class="fas fa-bookmark"></i> {{ store.isArabic ? 'حفظ' : 'Save' }}
        </button>
      </div>
      <div v-if="presets.length" class="preset-list">
        <div v-for="preset in presets" :key="preset.id" class="preset-row">
          <button type="button" class="preset-apply" @click="onApplyPreset(preset)">
            <i class="fas fa-filter" aria-hidden="true"></i>
            <span>{{ preset.name }}</span>
          </button>
          <button
            type="button"
            class="preset-delete"
            :aria-label="`${store.isArabic ? 'حذف' : 'Delete'} ${preset.name}`"
            @click="onDeletePreset(preset.id)"
          >
            <i class="fas fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <p v-else class="preset-empty">
        {{ store.isArabic ? 'لا توجد مرشحات محفوظة بعد.' : 'No saved presets yet.' }}
      </p>
    </section>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useStore } from '@/stores'
import type { PropertyFilters } from '@/types'
import {
  deleteFilterPreset,
  findFilterPreset,
  listFilterPresets,
  saveFilterPreset,
  type SavedFilterPreset
} from '@/utils/filterPresets'

const props = defineProps<{ initial?: PropertyFilters }>()
const emit = defineEmits<{ apply: [filters: PropertyFilters]; clear: [] }>()
const store = useStore()
const route = useRoute()

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

const scope = computed(() => String(store.user?.id || store.user?.email || 'anonymous'))
const presetName = ref('')
const presets = ref<SavedFilterPreset[]>(listFilterPresets(scope.value))

function refreshPresets(): void {
  presets.value = listFilterPresets(scope.value)
}

function onSavePreset(): void {
  presets.value = saveFilterPreset(scope.value, presetName.value, { ...form })
  presetName.value = ''
}

function onApplyPreset(preset: SavedFilterPreset): void {
  Object.assign(form, {
    search: '', city: '', type: '', status: '', minPrice: '', maxPrice: '',
    ...preset.filters
  })
  emit('apply', { ...form })
}

function onDeletePreset(id: string): void {
  presets.value = deleteFilterPreset(scope.value, id)
}

function applyRoutePreset(): void {
  const id = route.query.preset
  if (typeof id !== 'string' || !id) return
  const preset = findFilterPreset(scope.value, id)
  if (!preset) return
  onApplyPreset(preset)
}

onMounted(() => {
  if (props.initial) Object.assign(form, props.initial)
  refreshPresets()
  applyRoutePreset()
})

watch(() => store.user?.id, () => {
  refreshPresets()
})

watch(() => route.query.preset, () => {
  applyRoutePreset()
})

watch(() => props.initial, (value) => {
  if (value) Object.assign(form, value)
})
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
.btn { min-height: 44px; }

.presets { border-top: 1px solid #e5e7eb; margin-top: 0.9rem; padding-top: 0.8rem; }
.preset-heading { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: #374151; margin-bottom: 0.55rem; }
.preset-save { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.preset-save input { flex: 1 1 200px; min-height: 44px; }
.preset-list { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.6rem; }
.preset-row { display: inline-flex; align-items: stretch; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; }
.preset-apply, .preset-delete { min-height: 40px; border: 0; background: #fff; color: #374151; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; }
.preset-apply { padding-inline: 0.7rem; font-size: 0.8rem; }
.preset-delete { padding-inline: 0.6rem; color: #b91c1c; border-inline-start: 1px solid #e5e7eb; }
.preset-apply:hover { background: #eef2ff; }
.preset-delete:hover { background: #fef2f2; }
.preset-empty { margin: 0.6rem 0 0; font-size: 0.78rem; color: #6b7280; }

@media (max-width: 768px) {
  .actions { flex-wrap: wrap; }
  .preset-row { width: 100%; }
  .preset-apply { flex: 1; justify-content: flex-start; }
}
</style>
