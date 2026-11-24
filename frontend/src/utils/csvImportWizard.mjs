// Package 38: pure helpers for the four-step validated CSV import wizard.

export const IMPORT_WIZARD_STEPS = Object.freeze(['upload', 'validate', 'review', 'commit'])

export function wizardStage(preview, meta = {}) {
  if (!preview) return 'upload'
  if (meta.stage && IMPORT_WIZARD_STEPS.includes(meta.stage)) return meta.stage
  if ((preview.invalidCount ?? 0) > 0) return 'review'
  return 'commit'
}

export function canCommitImport(preview, meta = {}) {
  if ((preview?.validCount ?? 0) <= 0) return false
  if ((meta.missingHeaders?.length ?? 0) > 0) return false
  if (meta.canCommit === false) return false
  return true
}

export function errorSummary(preview) {
  const summary = {}
  for (const row of preview?.rows || []) {
    for (const issue of row.errors || []) {
      summary[issue.field] = (summary[issue.field] || 0) + 1
    }
  }
  return summary
}

function escapeCsvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rejectedRowsCsv(preview) {
  const lines = ['row,field,message,value']
  for (const row of preview?.rows || []) {
    for (const issue of row.errors || []) {
      lines.push([row.row, issue.field, issue.message, row.values?.[issue.field] ?? ''].map(escapeCsvCell).join(','))
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function wizardProgress(preview, meta = {}) {
  const stage = wizardStage(preview, meta)
  const index = IMPORT_WIZARD_STEPS.indexOf(stage)
  return {
    stage,
    current: index + 1,
    total: IMPORT_WIZARD_STEPS.length,
    percent: Math.round(((index + 1) / IMPORT_WIZARD_STEPS.length) * 100),
    canCommit: canCommitImport(preview, meta)
  }
}
