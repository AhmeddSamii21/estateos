<template>
  <section v-if="store.canManage" class="panel client-portal-panel no-print">
    <div class="panel-head">
      <h2>{{ store.isArabic ? 'بوابة العميل' : 'Client portal' }}</h2>
      <span class="tag" :class="link?.enabled ? 'active' : 'inactive'">
        {{ link?.enabled ? (store.isArabic ? 'مفعّلة' : 'Enabled') : (store.isArabic ? 'غير مفعّلة' : 'Disabled') }}
      </span>
    </div>
    <p class="muted">
      {{
        store.isArabic
          ? 'رابط للقراءة فقط ويمكن نسخه أو تجديده أو إلغاؤه في أي وقت.'
          : 'Read-only link that can be copied, rotated, or revoked at any time.'
      }}
    </p>

    <div v-if="loading" class="muted">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <template v-else>
      <div class="portal-url" v-if="link?.url">
        <span>{{ link.url }}</span>
      </div>
      <div class="portal-actions">
        <button class="btn btn-primary" type="button" :disabled="busy" @click="generate">
          {{ link?.enabled
            ? (store.isArabic ? 'نسخ الرابط' : 'Copy link')
            : (store.isArabic ? 'إنشاء رابط' : 'Generate link') }}
        </button>
        <button class="btn btn-quiet" type="button" :disabled="busy || !link?.enabled" @click="regenerate">
          {{ store.isArabic ? 'تجديد الرابط' : 'Regenerate' }}
        </button>
        <button class="btn btn-quiet danger" type="button" :disabled="busy || !link?.enabled" @click="revoke">
          {{ store.isArabic ? 'إلغاء الرابط' : 'Revoke' }}
        </button>
      </div>
    </template>

    <p v-if="message" class="muted">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { apiDelete, apiGet, apiPost, errorMessage } from '@/api/client'
import { useStore } from '@/stores'
import type { ClientPortalLink } from '@/types'

const props = defineProps<{
  entityType: 'Lead' | 'Deal'
  entityId: string
}>()

const store = useStore()
const link = ref<ClientPortalLink | null>(null)
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const error = ref('')

const resourcePath = () => props.entityType === 'Lead' ? 'leads' : 'deals'
const linkPath = () => `/${resourcePath()}/${props.entityId}/portal-token`

onMounted(() => { void load() })
watch(() => props.entityId, () => { void load() })

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await apiGet<ClientPortalLink>(`/${resourcePath()}/${props.entityId}/portal-link`)
    link.value = response.data
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function generate(): Promise<void> {
  if (busy.value || !props.entityId) return
  if (link.value?.enabled && link.value.url) {
    await copyLink(link.value.url)
    return
  }
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await apiPost<ClientPortalLink>(linkPath())
    link.value = response.data
    message.value = store.isArabic ? 'تم إنشاء رابط العميل.' : 'Client portal link created.'
    if (response.data.url) await copyLink(response.data.url)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function regenerate(): Promise<void> {
  if (busy.value || !props.entityId) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await apiPost<ClientPortalLink>(`${linkPath()}/regenerate`)
    link.value = response.data
    message.value = store.isArabic ? 'تم تجديد الرابط وإلغاء الرابط القديم.' : 'Link rotated; the previous link no longer works.'
    if (response.data.url) await copyLink(response.data.url)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function revoke(): Promise<void> {
  if (busy.value || !props.entityId) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await apiDelete<ClientPortalLink>(linkPath())
    link.value = response.data
    message.value = store.isArabic ? 'تم إلغاء رابط العميل.' : 'Client portal link revoked.'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function copyLink(url: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      const field = document.createElement('textarea')
      field.value = url
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    message.value = store.isArabic ? 'تم نسخ الرابط.' : 'Link copied to clipboard.'
  } catch {
    message.value = store.isArabic
      ? 'تعذر نسخ الرابط تلقائياً؛ انسخه من الحقل أدناه.'
      : 'Could not copy automatically; copy it from the field above.'
  }
}
</script>

<style scoped>
.client-portal-panel { display: flex; flex-direction: column; gap: 0.65rem; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h2 { margin: 0; font-size: 1.05rem; }
.muted { color: #6b7280; font-size: 0.82rem; margin: 0; }
.error { color: #991b1b; font-size: 0.82rem; }
.tag { border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.7rem; font-weight: 700; }
.tag.active { background: #ecfdf5; color: #047857; }
.tag.inactive { background: #f3f4f6; color: #6b7280; }
.portal-url { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.55rem 0.7rem; font-size: 0.78rem; overflow-wrap: anywhere; }
.portal-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
button { min-height: 40px; }
button.danger { color: #b91c1c; }
@media (max-width: 768px) {
  .portal-actions { flex-direction: column; }
  button { min-height: 44px; }
}
</style>
