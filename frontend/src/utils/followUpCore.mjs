// Package 41: pure follow-up automation helpers shared by the Vue UI and Node tests.

export const TRIGGERS = Object.freeze({
  NEW_LEAD: Object.freeze({ en: 'New lead', ar: 'عميل محتمل جديد' }),
  NO_CONTACT: Object.freeze({ en: 'No recent contact', ar: 'لا يوجد تواصل حديث' }),
  VIEWING_NO_DEAL: Object.freeze({ en: 'Viewing without deal', ar: 'معاينة بدون صفقة' }),
  DEAL_STALLED: Object.freeze({ en: 'Stalled deal', ar: 'صفقة متوقفة' })
})

export const CHANNELS = Object.freeze({
  NOTIFICATION: Object.freeze({ en: 'In-app notification', ar: 'إشعار داخل التطبيق' }),
  EMAIL: Object.freeze({ en: 'Email', ar: 'بريد إلكتروني' }),
  WHATSAPP: Object.freeze({ en: 'WhatsApp', ar: 'واتساب' })
})

export const TASK_STATUSES = Object.freeze({
  PENDING: Object.freeze({ en: 'Pending', ar: 'قيد الانتظار' }),
  COMPLETED: Object.freeze({ en: 'Completed', ar: 'مكتمل' }),
  CANCELLED: Object.freeze({ en: 'Cancelled', ar: 'ملغي' })
})

export function triggerLabel(trigger, language = 'en') {
  return (TRIGGERS[trigger] || { en: trigger, ar: trigger })[language === 'ar' ? 'ar' : 'en']
}

export function channelLabel(channel, language = 'en') {
  return (CHANNELS[channel] || { en: channel, ar: channel })[language === 'ar' ? 'ar' : 'en']
}

export function taskStatusLabel(status, language = 'en') {
  return (TASK_STATUSES[status] || { en: status, ar: status })[language === 'ar' ? 'ar' : 'en']
}

/** Only known `{{ key }}` placeholders are substituted; unknown ones stay literal. */
export function renderTemplate(template = '', variables = {}) {
  return String(template).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : token
  ))
}

export function dueDate(now, conditionDays = 3) {
  const days = Number.isFinite(Number(conditionDays)) && Number(conditionDays) > 0 ? Number(conditionDays) : 3
  return new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function groupTasks(tasks = []) {
  const groups = { PENDING: [], COMPLETED: [], CANCELLED: [] }
  for (const task of tasks) {
    if (groups[task.status]) groups[task.status].push(task)
  }
  for (const status of Object.keys(groups)) {
    groups[status].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
  }
  return groups
}

export function automationSummary(tasks = []) {
  const now = Date.now()
  const groups = groupTasks(tasks)
  return {
    total: tasks.length,
    pending: groups.PENDING.length,
    completed: groups.COMPLETED.length,
    cancelled: groups.CANCELLED.length,
    overdue: groups.PENDING.filter((task) => new Date(task.dueAt).getTime() < now).length
  }
}
