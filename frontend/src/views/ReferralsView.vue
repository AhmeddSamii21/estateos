<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'شركاء الإحالة' : 'Referral partners' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'إدارة الشركاء وحصص الإحالة على الصفقات مع تدقيق كامل.'
            : 'Manage partners and deal splits with a complete audit trail.' }}
        </p>
      </div>
      <button class="btn btn-quiet" type="button" :disabled="loading" @click="load">
        <i class="fas fa-rotate"></i> {{ store.isArabic ? 'تحديث' : 'Refresh' }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <section v-if="canManagePartners" class="panel">
      <h2>{{ store.isArabic ? 'إضافة شريك' : 'Add partner' }}</h2>
      <form class="grid" @submit.prevent="onCreatePartner">
        <label>
          <span>{{ store.isArabic ? 'الاسم' : 'Name' }}</span>
          <input v-model="partnerForm.name" required maxlength="120" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'الاسم بالعربية' : 'Arabic name' }}</span>
          <input v-model="partnerForm.nameAr" maxlength="120" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'نسبة العمولة ٪' : 'Commission rate %' }}</span>
          <input v-model="partnerForm.commissionRate" type="number" min="0" max="100" step="0.01" />
        </label>
        <label>
          <span>{{ store.isArabic ? 'البريد الإلكتروني' : 'Email' }}</span>
          <input v-model="partnerForm.email" type="email" maxlength="160" />
        </label>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '…' : (store.isArabic ? 'حفظ الشريك' : 'Save partner') }}
        </button>
      </form>
    </section>

    <section class="panel">
      <h2>{{ store.isArabic ? 'تسجيل حصة إحالة' : 'Record a referral split' }}</h2>
      <form class="grid" @submit.prevent="onCreateSplit">
        <label>
          <span>{{ store.isArabic ? 'الشريك' : 'Partner' }}</span>
          <select v-model="splitForm.partnerId" required>
            <option value="">{{ store.isArabic ? 'اختر شريكًا' : 'Choose a partner' }}</option>
            <option v-for="partner in activePartners" :key="partner.id" :value="partner.id">
              {{ store.isArabic ? (partner.nameAr || partner.name) : partner.name }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'الصفقة' : 'Deal' }}</span>
          <select v-model="splitForm.dealId" required>
            <option value="">{{ store.isArabic ? 'اختر صفقة' : 'Choose a deal' }}</option>
            <option v-for="deal in deals" :key="deal.id" :value="deal.id">
              {{ deal.referenceNumber || deal.id }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ store.isArabic ? 'النسبة ٪ (اختياري)' : 'Rate % (optional)' }}</span>
          <input v-model="splitForm.rate" type="number" min="0" max="100" step="0.01" />
        </label>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '…' : (store.isArabic ? 'تسجيل الحصة' : 'Record split') }}
        </button>
      </form>
      <p v-if="!deals.length" class="muted">
        {{ store.isArabic ? 'لا توجد صفقات متاحة.' : 'No deals available yet.' }}
      </p>
    </section>

    <section class="stats">
      <article class="stat">
        <span>{{ store.isArabic ? 'عدد الحصص' : 'Split count' }}</span>
        <strong>{{ summary?.splitCount ?? 0 }}</strong>
      </article>
      <article v-for="row in summary?.byPartner || []" :key="`${row.partnerId}-${row.currency}`" class="stat">
        <span>{{ row.partnerName }}</span>
        <strong>{{ row.total }} {{ row.currency }}</strong>
        <small>{{ row.count }} {{ store.isArabic ? 'حصة' : 'split(s)' }}</small>
      </article>
    </section>

    <section class="panel">
      <h2>{{ store.isArabic ? 'الشركاء' : 'Partners' }}</h2>
      <div v-if="!partners.length" class="empty">
        {{ store.isArabic ? 'لا يوجد شركاء بعد.' : 'No referral partners yet.' }}
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>{{ store.isArabic ? 'الاسم' : 'Name' }}</th>
            <th>{{ store.isArabic ? 'النسبة' : 'Rate' }}</th>
            <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="partner in partners" :key="partner.id">
            <td>{{ store.isArabic ? (partner.nameAr || partner.name) : partner.name }}</td>
            <td>{{ partner.commissionRate }}%</td>
            <td>{{ partner.isActive ? (store.isArabic ? 'نشط' : 'Active') : (store.isArabic ? 'متوقف' : 'Inactive') }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>{{ store.isArabic ? 'حصص الإحالة' : 'Referral splits' }}</h2>
      <div v-if="!splits.length" class="empty">
        {{ store.isArabic ? 'لا توجد حصص مسجلة.' : 'No referral splits recorded.' }}
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>{{ store.isArabic ? 'الصفقة' : 'Deal' }}</th>
            <th>{{ store.isArabic ? 'الشريك' : 'Partner' }}</th>
            <th>{{ store.isArabic ? 'النسبة' : 'Rate' }}</th>
            <th>{{ store.isArabic ? 'المبلغ' : 'Amount' }}</th>
            <th>{{ store.isArabic ? 'الحالة' : 'Status' }}</th>
            <th v-if="canApprove">{{ store.isArabic ? 'إجراءات' : 'Actions' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="split in splits" :key="split.id">
            <td>{{ split.dealReference || split.dealId }}</td>
            <td>{{ split.partnerName }}</td>
            <td>{{ split.rate }}%</td>
            <td>{{ split.amount }} {{ split.currency }}</td>
            <td><span class="status-pill">{{ statusLabel(split.status) }}</span></td>
            <td v-if="canApprove">
              <button
                v-if="split.status === 'PENDING'"
                class="btn btn-quiet"
                type="button"
                @click="onStatus(split, 'APPROVED')"
              >
                {{ store.isArabic ? 'اعتماد' : 'Approve' }}
              </button>
              <button
                v-if="split.status === 'PENDING' || split.status === 'APPROVED'"
                class="btn btn-primary"
                type="button"
                @click="onStatus(split, 'PAID')"
              >
                {{ store.isArabic ? 'دفع' : 'Mark paid' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, apiPost, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { ReferralPartner, ReferralSplit } from '@/types'

interface DealOption {
  id: string
  referenceNumber: string | null
}
interface SummaryRow {
  partnerId: string
  partnerName: string
  currency: string
  total: string
  count: number
}
interface Summary {
  splitCount: number
  byPartner: SummaryRow[]
}

const store = useStore()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const partners = ref<ReferralPartner[]>([])
const splits = ref<ReferralSplit[]>([])
const deals = ref<DealOption[]>([])
const summary = ref<Summary | null>(null)

const canManagePartners = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const canApprove = computed(() => canManagePartners.value || store.user?.role === 'TEAM_LEAD')
const activePartners = computed(() => partners.value.filter((partner) => partner.isActive))

const partnerForm = reactive({ name: '', nameAr: '', commissionRate: '10', email: '' })
const splitForm = reactive({ partnerId: '', dealId: '', rate: '' })

onMounted(load)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [partnerResponse, splitResponse, dealResponse, summaryResponse] = await Promise.all([
      apiGet<ReferralPartner[]>('/referrals/partners', { params: { limit: 100 } }),
      apiGet<ReferralSplit[]>('/referrals/splits', { params: { limit: 100 } }),
      apiGet<DealOption[]>('/deals', { params: { limit: 100 } }),
      apiGet<Summary>('/referrals/summary')
    ])
    partners.value = partnerResponse.data || []
    splits.value = splitResponse.data || []
    deals.value = dealResponse.data || []
    summary.value = summaryResponse.data || null
    if (!splitForm.partnerId && activePartners.value.length) splitForm.partnerId = activePartners.value[0].id
    if (!splitForm.dealId && deals.value.length) splitForm.dealId = deals.value[0].id
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function onCreatePartner(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await apiPost('/referrals/partners', {
      name: partnerForm.name,
      nameAr: partnerForm.nameAr || undefined,
      commissionRate: Number(partnerForm.commissionRate || 0),
      email: partnerForm.email || undefined
    })
    partnerForm.name = ''
    partnerForm.nameAr = ''
    partnerForm.email = ''
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function onCreateSplit(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await apiPost('/referrals/splits', {
      partnerId: splitForm.partnerId,
      dealId: splitForm.dealId,
      ...(splitForm.rate ? { rate: Number(splitForm.rate) } : {})
    })
    splitForm.rate = ''
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function onStatus(split: ReferralSplit, status: 'APPROVED' | 'PAID'): Promise<void> {
  error.value = ''
  try {
    await apiPatch(`/referrals/splits/${split.id}/status`, { status })
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

function statusLabel(status: ReferralSplit['status']): string {
  const labels: Record<ReferralSplit['status'], [string, string]> = {
    PENDING: ['Pending', 'قيد الانتظار'],
    APPROVED: ['Approved', 'معتمدة'],
    PAID: ['Paid', 'مدفوعة'],
    CANCELLED: ['Cancelled', 'ملغية']
  }
  return store.isArabic ? labels[status][1] : labels[status][0]
}
</script>
