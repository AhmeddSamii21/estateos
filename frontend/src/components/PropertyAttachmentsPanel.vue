<template>
  <section class="panel attachment-panel">
    <div class="panel-head">
      <h2>{{ store.isArabic ? 'المخططات والكتيّبات' : 'Floorplans & brochures' }}</h2>
    </div>

    <div v-if="canEdit" class="attachment-tools">
      <select v-model="uploadKind" :aria-label="store.isArabic ? 'نوع المرفق' : 'Attachment kind'">
        <option value="FLOORPLAN">{{ store.isArabic ? 'مخطط' : 'Floorplan' }}</option>
        <option value="BROCHURE">{{ store.isArabic ? 'كتيّب' : 'Brochure' }}</option>
      </select>
      <label class="btn btn-quiet upload-btn">
        <i class="fas fa-upload"></i> {{ store.isArabic ? 'رفع ملف' : 'Upload file' }}
        <input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" hidden @change="onUpload" />
      </label>
      <input v-model="linkName" type="text" maxlength="200" :placeholder="store.isArabic ? 'اسم المرفق' : 'Attachment name'" />
      <input v-model="linkUrl" type="url" :placeholder="store.isArabic ? 'رابط https://' : 'https:// link'" />
      <button class="btn btn-quiet" type="button" :disabled="busy || !linkName.trim() || !linkUrl.trim()" @click="addLink">
        {{ store.isArabic ? 'إضافة رابط' : 'Add link' }}
      </button>
    </div>

    <div v-if="error" class="error inline-error" role="alert">{{ error }}</div>
    <div v-if="busy" class="empty">{{ store.isArabic ? 'جارٍ التحديث…' : 'Updating…' }}</div>

    <div v-for="kind in kinds" :key="kind" class="attachment-group">
      <h3>{{ kindLabel(kind) }}</h3>
      <div v-if="!busy && !byKind(kind).length" class="empty">
        {{ store.isArabic ? 'لا توجد مرفقات.' : 'No attachments.' }}
      </div>
      <div v-else class="list">
        <div v-for="attachment in byKind(kind)" :key="attachment.id" class="list-row">
          <button type="button" class="link" @click="open(attachment)">
            <i class="fas fa-file"></i> {{ attachment.name || attachment.originalName }}
          </button>
          <button v-if="canEdit" type="button" class="link danger" :disabled="busy" @click="remove(attachment.id)">
            {{ store.isArabic ? 'إزالة' : 'Remove' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { apiDelete, apiGet, apiPost, errorMessage } from '@/api/client'
import { attachmentKindLabel, previewAttachment } from '@/utils/propertyAttachments'
import { useStore } from '@/stores'
import type { PropertyAttachment } from '@/types'

const props = defineProps<{ propertyId: string; canEdit?: boolean }>()
const store = useStore()
const kinds: PropertyAttachment['kind'][] = ['FLOORPLAN', 'BROCHURE']
const attachments = ref<PropertyAttachment[]>([])
const uploadKind = ref<PropertyAttachment['kind']>('FLOORPLAN')
const linkName = ref('')
const linkUrl = ref('')
const error = ref('')
const busy = ref(false)

function kindLabel(kind: PropertyAttachment['kind']): string {
  return attachmentKindLabel(kind, store.isArabic)
}

function byKind(kind: PropertyAttachment['kind']): PropertyAttachment[] {
  return attachments.value.filter((item) => item.kind === kind)
}

async function load(): Promise<void> {
  if (!props.propertyId) return
  try {
    const response = await apiGet<PropertyAttachment[]>(`/properties/${props.propertyId}/attachments`)
    attachments.value = response.data || []
    error.value = ''
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function onUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    const form = new FormData()
    form.append('kind', uploadKind.value)
    form.append('file', file)
    await apiPost(`/properties/${props.propertyId}/attachments`, form)
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
    input.value = ''
  }
}

async function addLink(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await apiPost(`/properties/${props.propertyId}/attachments`, {
      kind: uploadKind.value,
      name: linkName.value.trim(),
      url: linkUrl.value.trim()
    })
    linkName.value = ''
    linkUrl.value = ''
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function remove(id: string): Promise<void> {
  if (!window.confirm(store.isArabic ? 'إزالة هذا المرفق؟' : 'Remove this attachment?')) return
  busy.value = true
  error.value = ''
  try {
    await apiDelete(`/properties/${props.propertyId}/attachments/${id}`)
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function open(attachment: PropertyAttachment): Promise<void> {
  error.value = ''
  try {
    await previewAttachment(attachment)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

watch(() => props.propertyId, () => { void load() }, { immediate: true })
</script>

<style scoped>
.attachment-panel { margin-top: 1rem; }
.attachment-tools { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.8rem; }
.attachment-tools input[type='text'], .attachment-tools input[type='url'] { flex: 1 1 180px; min-width: 0; }
.upload-btn { cursor: pointer; min-height: 44px; }
.attachment-group { margin-top: 0.9rem; }
.attachment-group h3 { font-size: 0.9rem; margin: 0 0 0.4rem; }
.list-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; min-height: 44px; }
.link { margin: 0; padding: 0; background: none; border: 0; color: #4338ca; cursor: pointer; text-align: start; }
.link.danger { color: #b91c1c; }
.link:disabled { opacity: 0.45; cursor: not-allowed; }
.inline-error { margin: 0.4rem 0; }
</style>
