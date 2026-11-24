export interface FollowUpTaskLike {
  id: string
  status: string
  dueAt: string | Date
  title: string
  titleAr?: string | null
}

export declare const TRIGGERS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>>
export declare const CHANNELS: Readonly<Record<string, Readonly<{ en: string; ar: string }>>>
export declare const TASK_STATUSES: Readonly<Record<string, Readonly<{ en: string; ar: string }>>>

export declare function triggerLabel(trigger: string, language?: string): string
export declare function channelLabel(channel: string, language?: string): string
export declare function taskStatusLabel(status: string, language?: string): string
export declare function renderTemplate(template?: string, variables?: Record<string, unknown>): string
export declare function dueDate(now: string | Date, conditionDays?: number): string
export declare function groupTasks(tasks?: FollowUpTaskLike[]): Record<string, FollowUpTaskLike[]>
export declare function automationSummary(tasks?: FollowUpTaskLike[]): {
  total: number
  pending: number
  completed: number
  cancelled: number
  overdue: number
}
