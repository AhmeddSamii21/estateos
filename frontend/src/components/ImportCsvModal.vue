<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <section class="modal" role="dialog" aria-modal="true" aria-label="Import CSV">
      <div class="modal-head">
        <h2>Import CSV</h2>
        <button type="button" aria-label="Close" @click="emit('close')">×</button>
      </div>

      <div class="modal-body">
        <p class="muted">
          {{ kind === 'properties' ? 'Import properties' : 'Import leads' }} from a CSV file.
          Validate a preview before committing any rows.
        </p>

        <button class="btn btn-quiet" type="button" @click="downloadTemplate">
          <i class="fas fa-download"></i> Download template
        </button>

        <label class="field">
          <span>CSV file</span>
          <input type="file" accept=".csv,text/csv" @change="onFileChange" />
        </label>

        <label class="field">
          <span>CSV contents</span>
          <textarea v-model="csv" rows="8" spellcheck="false" placeholder="Paste CSV here or choose a file…"></textarea>
        </label>

        <div class="actions">
          <button class="btn btn-quiet" type="button" :disabled="busy || !csv.trim()" @click="onPreview">
            {{ busy ? '…' : 'Preview / Validate' }}
          </button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="busy || !canCommit"
            @click="onCommit"
          >
            {{ busy ? '…' : `Import ${preview?.validCount ?? 0} valid rows` }}
          </button>
        </div>

        <div v-if="localError || error" class="error" role="alert">{{ localError || error }}</div>
        <div v-if="resultMessage" class="notice" role="status">{{ resultMessage }}</div>

        <template v-if="preview">
          <div class="preview-summary">
            <strong>{{ preview.validCount }} valid</strong>
            <span>{{ preview.invalidCount }} invalid</span>
          </div>

          <div v-if="!preview.rows.length" class="small muted">No rows found in this CSV.</div>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th v-for="header in preview.headers" :key="header">{{ header }}</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in preview.rows" :key="row.row" :class="{ invalid: row.errors?.length }">
                  <td>{{ row.row }}</td>
                  <td v-for="header in preview.headers" :key="header">{{ cell(row.values?.[header]) }}</td>
                  <td>
                    <span v-for="(issue, index) in row.errors || []" :key="index" class="row-error">
                      {{ issue.field }}: {{ issue.message }}
                    </span>
                    <span v-if="!row.errors?.length" class="small muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  downloadImportTemplate,
  LEAD_IMPORT_HEADERS,
  PROPERTY_IMPORT_HEADERS,
  readFileAsText,
  type CsvImportPreview
} from '@/utils/csvImport'

const props = defineProps<{
  open: boolean
  kind: 'properties' | 'leads'
  busy?: boolean
  preview?: CsvImportPreview | null
  error?: string
  resultMessage?: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'preview', payload: { csv: string; dryRun: true }): void
  (event: 'commit', payload: { csv: string; dryRun: false }): void
}>()

const csv = ref('')
const localError = ref('')

const canCommit = computed(() =>
  (props.preview?.validCount ?? 0) > 0
  && !props.error
  && !localError.value
  && Boolean(csv.value.trim())
)

watch(() => props.open, (open) => {
  if (open) {
    csv.value = ''
    localError.value = ''
  }
})

function headers(): readonly string[] {
  return props.kind === 'properties' ? PROPERTY_IMPORT_HEADERS : LEAD_IMPORT_HEADERS
}

function downloadTemplate(): void {
  const filename = props.kind === 'properties' ? 'properties-import-template.csv' : 'leads-import-template.csv'
  downloadImportTemplate(filename, headers())
}

async function onFileChange(event: Event): Promise<void> {
  localError.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    csv.value = await readFileAsText(file)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : 'Could not read the selected file.'
  }
}

function onPreview(): void {
  if (!csv.value.trim() || props.busy) return
  emit('preview', { csv: csv.value, dryRun: true })
}

function onCommit(): void {
  if (!canCommit.value || props.busy) return
  emit('commit', { csv: csv.value, dryRun: false })
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: grid; place-items: center; padding: 1rem; z-index: 30; }
.modal { background: #fff; border-radius: 14px; width: min(100%, 900px); max-height: 90vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.2rem; border-bottom: 1px solid #eef2f7; }
.modal-head h2 { margin: 0; font-size: 1.15rem; }
.modal-head button { background: none; border: 0; font-size: 1.4rem; cursor: pointer; }
.modal-body { padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; }
.muted { color: #6b7280; margin: 0; font-size: 0.84rem; }
.small { font-size: 0.78rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #374151; }
textarea, input[type='file'] { font-family: inherit; font-size: 0.86rem; }
textarea { border: 1px solid #d1d5db; border-radius: 8px; padding: 0.6rem; width: 100%; resize: vertical; }
.btn { border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.error { background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 0.6rem 0.7rem; font-size: 0.84rem; }
.notice { background: #eef2ff; color: #3730a3; border-radius: 8px; padding: 0.6rem 0.7rem; font-size: 0.84rem; }
.preview-summary { display: flex; gap: 0.8rem; align-items: center; font-size: 0.84rem; }
.preview-summary strong { color: #166534; }
.table-wrap { max-height: 320px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
th, td { text-align: start; padding: 0.45rem 0.6rem; border-bottom: 1px solid #f3f4f6; white-space: nowrap; }
th { position: sticky; top: 0; background: #f9fafb; color: #6b7280; font-size: 0.7rem; text-transform: uppercase; }
tr.invalid { background: #fff7f7; }
.row-error { display: block; color: #991b1b; font-size: 0.72rem; }
</style>
