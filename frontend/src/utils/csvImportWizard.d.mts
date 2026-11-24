export interface CsvPreviewLike {
  rows: Array<{ row: number; values?: Record<string, unknown>; errors: Array<{ field: string; message: string }> }>
  validCount: number
  invalidCount: number
}

export interface WizardMeta {
  stage?: string
  missingHeaders?: string[]
  canCommit?: boolean
}

export declare const IMPORT_WIZARD_STEPS: readonly string[]

export declare function wizardStage(preview: CsvPreviewLike | null, meta?: WizardMeta): string
export declare function canCommitImport(preview: CsvPreviewLike | null, meta?: WizardMeta): boolean
export declare function errorSummary(preview: CsvPreviewLike | null): Record<string, number>
export declare function rejectedRowsCsv(preview: CsvPreviewLike | null): string
export declare function wizardProgress(preview: CsvPreviewLike | null, meta?: WizardMeta): {
  stage: string
  current: number
  total: number
  percent: number
  canCommit: boolean
}
