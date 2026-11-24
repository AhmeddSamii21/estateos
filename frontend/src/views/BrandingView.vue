<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'هوية المؤسسة' : 'White-label branding' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'تخصيص الاسم والشعار والألوان ومعلومات الدعم لكل مؤسسة.'
            : 'Customize the name, logo, colors and support details for this organization.' }}
        </p>
      </div>
      <span v-if="!canManage" class="status-pill quota-ok">
        {{ store.isArabic ? 'عرض فقط' : 'Read only' }}
      </span>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="message" class="alert alert-success" role="status">{{ message }}</div>

    <div class="branding-layout">
      <section class="panel">
        <form v-if="canManage" class="branding-form" @submit.prevent="save">
          <label>
            <span>{{ store.isArabic ? 'الاسم التجاري' : 'Brand name' }}</span>
            <input v-model="form.brandName" maxlength="120" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'الاسم التجاري بالعربية' : 'Arabic brand name' }}</span>
            <input v-model="form.brandNameAr" maxlength="120" dir="rtl" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'رابط الشعار' : 'Logo URL' }}</span>
            <input v-model="form.logoUrl" maxlength="500" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'رابط الأيقونة' : 'Favicon URL' }}</span>
            <input v-model="form.faviconUrl" maxlength="500" />
          </label>
          <div class="color-grid">
            <label>
              <span>{{ store.isArabic ? 'اللون الأساسي' : 'Primary color' }}</span>
              <input v-model="form.primaryColor" type="color" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'اللون الثانوي' : 'Secondary color' }}</span>
              <input v-model="form.secondaryColor" type="color" />
            </label>
            <label>
              <span>{{ store.isArabic ? 'اللون المميز' : 'Accent color' }}</span>
              <input v-model="form.accentColor" type="color" />
            </label>
          </div>
          <label>
            <span>{{ store.isArabic ? 'السمة' : 'Theme' }}</span>
            <select v-model="form.theme">
              <option value="LIGHT">{{ store.isArabic ? 'فاتح' : 'Light' }}</option>
              <option value="DARK">{{ store.isArabic ? 'داكن' : 'Dark' }}</option>
              <option value="AUTO">{{ store.isArabic ? 'تلقائي' : 'Auto' }}</option>
            </select>
          </label>
          <label>
            <span>{{ store.isArabic ? 'بريد الدعم' : 'Support email' }}</span>
            <input v-model="form.supportEmail" maxlength="254" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'هاتف الدعم' : 'Support phone' }}</span>
            <input v-model="form.supportPhone" maxlength="50" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'تذييل الصفحة' : 'Footer text' }}</span>
            <textarea v-model="form.footerText" rows="2" maxlength="500"></textarea>
          </label>
          <label>
            <span>{{ store.isArabic ? 'التذييل بالعربية' : 'Arabic footer text' }}</span>
            <textarea v-model="form.footerTextAr" rows="2" maxlength="500" dir="rtl"></textarea>
          </label>
          <label class="checkbox">
            <input v-model="form.isActive" type="checkbox" />
            <span>{{ store.isArabic ? 'تفعيل الهوية' : 'Branding active' }}</span>
          </label>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? '…' : (store.isArabic ? 'حفظ الهوية' : 'Save branding') }}
          </button>
        </form>
        <p v-else class="muted">
          {{ store.isArabic ? 'يمكن لمدير المؤسسة فقط تعديل الهوية.' : 'Only organization managers can edit branding.' }}
        </p>
      </section>

      <section class="panel preview-panel">
        <h2>{{ store.isArabic ? 'معاينة مباشرة' : 'Live preview' }}</h2>
        <div class="brand-preview" :style="cssVariables" :dir="previewDirection">
          <header class="preview-header">
            <img v-if="safeLogo" :src="safeLogo" :alt="displayName" />
            <strong>{{ displayName }}</strong>
          </header>
          <p>{{ store.isArabic ? 'مرحباً بكم في مساحة عملكم.' : 'Welcome to your workspace.' }}</p>
          <button type="button">{{ store.isArabic ? 'ابدأ الآن' : 'Get started' }}</button>
          <footer>{{ previewFooter }}</footer>
        </div>
        <dl class="brand-meta">
          <dt>{{ store.isArabic ? 'الدعم' : 'Support' }}</dt>
          <dd>{{ form.supportEmail || '—' }} · {{ form.supportPhone || '—' }}</dd>
        </dl>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPatch, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import {
  brandingCssVariables,
  brandingDirection,
  displayBrandName,
  mergeBranding,
  safeBrandUrl
} from '@/utils/brandingCore.mjs'

interface Branding {
  brandName: string | null
  brandNameAr: string | null
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
  accentColor: string
  supportEmail: string | null
  supportPhone: string | null
  footerText: string | null
  footerTextAr: string | null
  theme: 'LIGHT' | 'DARK' | 'AUTO'
  isActive: boolean
  displayName?: string
  direction?: string
}

const store = useStore()
const canManage = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const branding = ref<Branding | null>(null)
const error = ref('')
const message = ref('')
const saving = ref(false)
const form = reactive({
  brandName: '',
  brandNameAr: '',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#2563EB',
  secondaryColor: '#0F172A',
  accentColor: '#14B8A6',
  theme: 'LIGHT',
  supportEmail: '',
  supportPhone: '',
  footerText: '',
  footerTextAr: '',
  isActive: true
})

const safeLogo = computed(() => safeBrandUrl(form.logoUrl))
const displayName = computed(() => displayBrandName(form, branding.value?.displayName || 'EstateOS', store.isArabic ? 'ar' : 'en'))
const previewDirection = computed(() => brandingDirection(form, store.isArabic ? 'ar' : 'en'))
const previewFooter = computed(() => (store.isArabic ? form.footerTextAr : form.footerText) || 'EstateOS')
const cssVariables = computed(() => brandingCssVariables(form))

onMounted(load)

async function load(): Promise<void> {
  error.value = ''
  try {
    const response = await apiGet<Branding>('/branding')
    branding.value = response.data
    const normalized = mergeBranding(response.data)
    Object.assign(form, {
      brandName: normalized.brandName || '',
      brandNameAr: normalized.brandNameAr || '',
      logoUrl: normalized.logoUrl || '',
      faviconUrl: normalized.faviconUrl || '',
      primaryColor: normalized.primaryColor,
      secondaryColor: normalized.secondaryColor,
      accentColor: normalized.accentColor,
      theme: normalized.theme,
      supportEmail: normalized.supportEmail || '',
      supportPhone: normalized.supportPhone || '',
      footerText: normalized.footerText || '',
      footerTextAr: normalized.footerTextAr || '',
      isActive: normalized.isActive
    })
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function save(): Promise<void> {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await apiPatch<Branding>('/branding', form)
    branding.value = response.data
    message.value = store.isArabic ? 'تم حفظ الهوية بنجاح.' : 'Branding saved successfully.'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.branding-layout { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 1rem; align-items: start; }
.branding-form, .color-grid { display: grid; gap: 0.7rem; }
.color-grid { grid-template-columns: repeat(3, 1fr); }
.checkbox { display: flex; align-items: center; gap: 0.5rem; }
.brand-preview { border: 1px solid var(--border, #d8dee9); border-radius: 14px; padding: 1.2rem; background: var(--brand-background); color: var(--brand-foreground); min-height: 280px; display: flex; flex-direction: column; gap: 1rem; }
.preview-header { display: flex; align-items: center; gap: 0.6rem; }
.preview-header img { width: 44px; height: 44px; object-fit: contain; }
.brand-preview button { align-self: start; border: 0; border-radius: 8px; padding: 0.6rem 1rem; background: var(--brand-primary); color: #fff; }
.brand-preview footer { margin-top: auto; border-top: 1px solid var(--brand-accent); padding-top: 0.5rem; font-size: 0.8rem; }
.brand-meta { margin-top: 1rem; font-size: 0.85rem; }
.brand-meta dt { font-weight: 600; }
.brand-meta dd { margin: 0 0 0.5rem; }
@media (max-width: 900px) { .branding-layout { grid-template-columns: 1fr; } }
</style>
