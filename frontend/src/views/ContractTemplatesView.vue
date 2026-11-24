<template>
  <div class="page" :dir="store.direction">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'قوالب العقود' : 'Contract templates' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'قوالب ثنائية اللغة مع معاينة آمنة للعناصر النائبة.'
            : 'Bilingual templates with safe placeholder previews.' }}
        </p>
      </div>
      <button class="btn btn-quiet no-print" type="button" :disabled="!preview" @click="onPrint">
        <i class="fas fa-print"></i> {{ store.isArabic ? 'طباعة' : 'Print' }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="contract-layout">
      <section class="panel">
        <h2>{{ store.isArabic ? 'القوالب' : 'Templates' }}</h2>
        <div v-if="!templates.length" class="empty">
          {{ store.isArabic ? 'لا توجد قوالب بعد.' : 'No templates yet.' }}
        </div>
        <ul v-else class="template-list">
          <li v-for="template in templates" :key="template.id">
            <button type="button" :class="{ active: selectedId === template.id }" @click="select(template)">
              <span>{{ store.isArabic ? (template.nameAr || template.name) : template.name }}</span>
              <small>v{{ template.version }} · {{ template.language }}</small>
            </button>
          </li>
        </ul>

        <form v-if="canManage" class="template-form" @submit.prevent="onCreate">
          <h3>{{ store.isArabic ? 'قالب جديد' : 'New template' }}</h3>
          <label>
            <span>{{ store.isArabic ? 'الاسم' : 'Name' }}</span>
            <input v-model="form.name" required maxlength="120" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'الاسم بالعربية' : 'Arabic name' }}</span>
            <input v-model="form.nameAr" maxlength="120" />
          </label>
          <label>
            <span>{{ store.isArabic ? 'اللغة' : 'Language' }}</span>
            <select v-model="form.language">
              <option value="BILINGUAL">{{ store.isArabic ? 'ثنائية اللغة' : 'Bilingual' }}</option>
              <option value="EN">English</option>
              <option value="AR">العربية</option>
            </select>
          </label>
          <label>
            <span>{{ store.isArabic ? 'النص الإنجليزي' : 'English body' }}</span>
            <textarea v-model="form.body" rows="5" required></textarea>
          </label>
          <label>
            <span>{{ store.isArabic ? 'النص العربي' : 'Arabic body' }}</span>
            <textarea v-model="form.bodyAr" rows="5" dir="rtl"></textarea>
          </label>
          <p class="hint">
            {{ store.isArabic ? 'العناصر المتاحة:' : 'Available tokens:' }} {{ CONTRACT_TOKENS.join(', ') }}
          </p>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? '…' : (store.isArabic ? 'حفظ القالب' : 'Save template') }}
          </button>
        </form>
      </section>

      <section class="panel preview-panel">
        <h2>{{ store.isArabic ? 'معاينة' : 'Preview' }}</h2>
        <div class="preview-controls">
          <label>
            <span>{{ store.isArabic ? 'الصفقة' : 'Deal' }}</span>
            <select v-model="dealId" @change="renderPreview">
              <option value="">{{ store.isArabic ? 'اختر صفقة' : 'Choose a deal' }}</option>
              <option v-for="deal in deals" :key="deal.id" :value="deal.id">
                {{ deal.referenceNumber || deal.id }}
              </option>
            </select>
          </label>
          <label>
            <span>{{ store.isArabic ? 'اللغة' : 'Language' }}</span>
            <select v-model="language" @change="renderPreview">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>

        <div v-if="!preview" class="empty">
          {{ store.isArabic ? 'اختر قالبًا وصفقة لعرض المعاينة.' : 'Select a template and deal to preview.' }}
        </div>
        <article v-else class="contract-preview" :dir="preview.direction">
          <h3>{{ preview.title }}</h3>
          <p class="muted">{{ preview.dealReference }} · v{{ preview.version }}</p>
          <pre>{{ preview.body }}</pre>
          <p v-if="preview.missingTokens.length" class="alert alert-warning">
            {{ store.isArabic ? 'عناصر غير معروفة:' : 'Unknown tokens:' }} {{ preview.missingTokens.join(', ') }}
          </p>
        </article>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiGet, apiPost, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import { CONTRACT_TOKENS } from '@/utils/contractTemplateCore.mjs'
import type { ContractTemplate } from '@/types'

interface DealOption {
  id: string
  referenceNumber: string | null
}
interface Preview {
  title: string
  body: string
  language: 'en' | 'ar'
  direction: 'ltr' | 'rtl'
  missingTokens: string[]
  hasArabicBody: boolean
  dealId: string
  templateId: string
  version: number
  dealReference?: string
}

const store = useStore()
const canManage = computed(() => store.user?.role === 'ADMIN' || store.user?.role === 'MANAGER')
const templates = ref<ContractTemplate[]>([])
const deals = ref<DealOption[]>([])
const selectedId = ref('')
const dealId = ref('')
const language = ref<'en' | 'ar'>('en')
const preview = ref<Preview | null>(null)
const saving = ref(false)
const error = ref('')

const form = reactive({
  name: '',
  nameAr: '',
  language: 'BILINGUAL',
  body: '',
  bodyAr: ''
})

onMounted(load)

async function load(): Promise<void> {
  error.value = ''
  try {
    const [templateResponse, dealResponse] = await Promise.all([
      apiGet<ContractTemplate[]>('/contracts/templates', { params: { limit: 100 } }),
      apiGet<DealOption[]>('/deals', { params: { limit: 100 } })
    ])
    templates.value = templateResponse.data || []
    deals.value = dealResponse.data || []
    if (!selectedId.value && templates.value.length) select(templates.value[0])
    if (!dealId.value && deals.value.length) dealId.value = deals.value[0].id
    await renderPreview()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

function select(template: ContractTemplate): void {
  selectedId.value = template.id
  language.value = store.isArabic ? 'ar' : 'en'
  void renderPreview()
}

async function renderPreview(): Promise<void> {
  if (!selectedId.value || !dealId.value) {
    preview.value = null
    return
  }
  error.value = ''
  try {
    const response = await apiPost<Preview>(`/contracts/templates/${selectedId.value}/render`, {
      dealId: dealId.value,
      language: language.value
    })
    preview.value = response.data
  } catch (caught) {
    error.value = errorMessage(caught)
    preview.value = null
  }
}

async function onCreate(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    const response = await apiPost<ContractTemplate>('/contracts/templates', {
      name: form.name,
      nameAr: form.nameAr || undefined,
      language: form.language,
      body: form.body,
      bodyAr: form.bodyAr || undefined
    })
    form.name = ''
    form.nameAr = ''
    form.body = ''
    form.bodyAr = ''
    selectedId.value = response.data.id
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

function onPrint(): void {
  window.print()
}
</script>

<style scoped>
.contract-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 1rem;
  align-items: start;
}
.template-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.template-list button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem;
  border: 1px solid var(--border, #d8dee9);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.template-list button.active {
  border-color: var(--primary, #2563eb);
  background: rgba(37, 99, 235, 0.08);
}
.template-form,
.preview-controls {
  display: grid;
  gap: 0.6rem;
}
.preview-controls {
  grid-template-columns: 1fr 1fr;
  margin-bottom: 1rem;
}
.contract-preview pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  line-height: 1.8;
}
.hint {
  font-size: 0.8rem;
  opacity: 0.75;
  word-break: break-word;
}
@media (max-width: 900px) {
  .contract-layout {
    grid-template-columns: 1fr;
  }
}
</style>
