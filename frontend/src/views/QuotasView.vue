<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'خطة المؤسسة والحدود' : 'Plan & usage quotas' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'الحدود تُطبّق عند إنشاء المستخدمين والعقارات والصفقات.'
            : 'Limits are enforced when creating users, properties and deals.' }}
        </p>
      </div>
      <div class="head-actions no-print">
        <select v-model="plan" :disabled="!canManage || saving" :aria-label="store.isArabic ? 'الخطة' : 'Plan'" @change="save">
          <option v-for="option in plans" :key="option" :value="option">{{ planName(option, store.isArabic ? 'ar' : 'en') }}</option>
        </select>
        <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
          <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <template v-else-if="quota">
      <section class="stats">
        <article class="stat">
          <span>{{ store.isArabic ? 'الخطة الحالية' : 'Current plan' }}</span>
          <strong>{{ planName(quota.plan, store.isArabic ? 'ar' : 'en') }}</strong>
        </article>
        <article class="stat">
          <span>{{ store.isArabic ? 'الحدود المتجاوزة' : 'Limits reached' }}</span>
          <strong>{{ reachedCount }}</strong>
        </article>
      </section>

      <section class="panel">
        <div v-for="row in rows" :key="row.key" class="quota-row">
          <div class="quota-head">
            <strong>{{ row.label }}</strong>
            <span>{{ row.used }} / {{ row.limit === null ? '∞' : row.limit }}</span>
          </div>
          <div class="progress" :aria-label="`${row.label}: ${row.percent ?? 0}%`">
            <div
              class="progress-fill"
              :class="`quota-${row.status.toLowerCase()}`"
              :style="{ width: `${Math.min(100, row.percent ?? (row.limit === null ? 5 : 100))}%` }"
            ></div>
            <span>{{ statusLabel(row.status) }}</span>
          </div>
          <small class="muted">{{ hint(row.status) }}</small>
        </div>
      </section>

      <section v-if="canManage" class="panel overrides">
        <h2>{{ store.isArabic ? 'حدود مخصصة' : 'Custom caps' }}</h2>
        <p class="muted">
          {{ store.isArabic ? 'اترك الحقل فارغاً لاستخدام حد الخطة، أو أدخل 0 لمنع النوع.' : 'Leave blank to use the plan default, or enter 0 to block a resource.' }}
        </p>
        <div class="override-grid">
          <label v-for="key in keys" :key="key">
            <span>{{ key }}</span>
            <input v-model.number="overrides[key]" type="number" min="0" :placeholder="String(quota.limits[key] ?? '∞')" />
          </label>
        </div>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="saveOverrides">
          {{ saving ? '…' : (store.isArabic ? 'حفظ الحدود' : 'Save caps') }}
        </button>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import { planName, quotaRows, upgradeHint } from '@/utils/planQuotaCore.mjs'

type QuotaKey = 'users' | 'properties' | 'deals' | 'storageMb'
type Status = 'UNLIMITED' | 'LIMIT_REACHED' | 'WARNING' | 'OK'
interface Quota {
  plan: string
  isActive: boolean
  usage: Record<QuotaKey, number>
  limits: Record<QuotaKey, number | null>
  entries: Array<{ key: QuotaKey; label: string; labelAr: string; used: number; limit: number | null; remaining: number | null; percent: number | null; status: Status }>
}

const store = useStore()
const canManage = computed(() => store.user?.role === 'ADMIN')
const plans = ['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE']
const keys: QuotaKey[] = ['users', 'properties', 'deals', 'storageMb']
const quota = ref<Quota | null>(null)
const plan = ref('FREE')
const overrides = reactive<Record<QuotaKey, number | ''>>({ users: '', properties: '', deals: '', storageMb: '' })
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const rows = computed(() => (quota.value
  ? quotaRows(quota.value.usage, quota.value.limits, store.isArabic ? 'ar' : 'en')
  : []))
const reachedCount = computed(() => rows.value.filter((row) => row.status === 'LIMIT_REACHED').length)

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await apiGet<Quota>('/quotas', { params: { language: store.isArabic ? 'ar' : 'en' } })
    quota.value = response.data
    plan.value = response.data?.plan || 'FREE'
    for (const key of keys) overrides[key] = ''
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function statusLabel(status: Status): string {
  const labels: Record<Status, [string, string]> = {
    UNLIMITED: ['Unlimited', 'غير محدود'],
    LIMIT_REACHED: ['Limit reached', 'تم بلوغ الحد'],
    WARNING: ['Near limit', 'قريب من الحد'],
    OK: ['OK', 'ضمن الحد']
  }
  return store.isArabic ? labels[status][1] : labels[status][0]
}

function hint(status: Status): string {
  const hintKey = upgradeHint(status)
  const labels: Record<string, [string, string]> = {
    UNLIMITED: ['No cap on this plan', 'لا يوجد حد في هذه الخطة'],
    UPGRADE_REQUIRED: ['Upgrade or raise the cap to continue', 'قم بالترقية أو رفع الحد للمتابعة'],
    CONSIDER_UPGRADE: ['Consider a higher plan', 'فكر في خطة أعلى'],
    HEALTHY: ['Usage is healthy', 'الاستخدام ضمن المعدل الطبيعي']
  }
  const pair = labels[hintKey] || labels.HEALTHY
  return store.isArabic ? pair[1] : pair[0]
}

async function save(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await apiPatch('/quotas', { plan: plan.value })
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
    await load()
  } finally {
    saving.value = false
  }
}

async function saveOverrides(): Promise<void> {
  saving.value = true
  error.value = ''
  const payload: Record<QuotaKey, number | null> = { users: null, properties: null, deals: null, storageMb: null }
  for (const key of keys) {
    const current = quota.value?.limits[key]
    payload[key] = overrides[key] === '' ? (current ?? null) : Number(overrides[key])
  }
  try {
    await apiPatch('/quotas', { plan: plan.value, overrides: payload })
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.quota-row { padding: 0.7rem 0; border-bottom: 1px solid var(--border, #eef2f7); }
.quota-head { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.9rem; }
.override-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.7rem; margin: 0.8rem 0; }
.override-grid label { display: grid; gap: 0.3rem; font-size: 0.8rem; }
</style>
