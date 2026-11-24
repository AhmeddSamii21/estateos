import type { PermissionMatrix, Role } from '@/types'

export const PERMISSION_KEYS = [
  'properties.view',
  'properties.manage',
  'leads.view',
  'leads.manage',
  'deals.view',
  'deals.manage',
  'finance.view',
  'finance.manage',
  'reports.view',
  'settings.manage',
  'users.manage',
  'audit.export',
  'activity.view',
  'snapshots.export'
] as const

export const PERMISSION_LABELS: Record<string, [string, string]> = {
  'properties.view': ['View properties', 'عرض العقارات'],
  'properties.manage': ['Manage properties', 'إدارة العقارات'],
  'leads.view': ['View leads', 'عرض العملاء المحتملين'],
  'leads.manage': ['Manage leads', 'إدارة العملاء المحتملين'],
  'deals.view': ['View deals', 'عرض الصفقات'],
  'deals.manage': ['Manage deals', 'إدارة الصفقات'],
  'finance.view': ['View finance', 'عرض المالية'],
  'finance.manage': ['Manage finance', 'إدارة المالية'],
  'reports.view': ['View reports', 'عرض التقارير'],
  'settings.manage': ['Manage settings', 'إدارة الإعدادات'],
  'users.manage': ['Manage users', 'إدارة المستخدمين'],
  'audit.export': ['Export audit log', 'تصدير سجل التدقيق'],
  'activity.view': ['View activity', 'عرض النشاط'],
  'snapshots.export': ['Export snapshot', 'تصدير نسخة شاملة']
}

export const ROLE_LABELS: Record<Role, [string, string]> = {
  ADMIN: ['Administrator', 'مدير عام'],
  MANAGER: ['Manager', 'مدير'],
  AGENT: ['Agent', 'وكيل'],
  ACCOUNTANT: ['Accountant', 'محاسب']
}

const all = (value: boolean): Record<string, boolean> =>
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, value]))

/** Client-side mirror of the backend matrix, used as an offline fallback. */
export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  roles: ['ADMIN', 'MANAGER', 'AGENT', 'ACCOUNTANT'],
  permissions: [...PERMISSION_KEYS],
  matrix: {
    ADMIN: all(true),
    MANAGER: { ...all(true), 'snapshots.export': false },
    ACCOUNTANT: {
      ...all(false),
      'properties.view': true,
      'leads.view': true,
      'deals.view': true,
      'finance.view': true,
      'finance.manage': true,
      'reports.view': true,
      'activity.view': true
    },
    AGENT: {
      ...all(false),
      'properties.view': true,
      'properties.manage': true,
      'leads.view': true,
      'leads.manage': true,
      'deals.view': true,
      'deals.manage': true,
      'activity.view': true
    }
  }
}

export function permissionLabel(key: string, isArabic: boolean): string {
  const pair = PERMISSION_LABELS[key]
  return pair ? (isArabic ? pair[1] : pair[0]) : key
}

export function roleLabel(role: string, isArabic: boolean): string {
  const pair = ROLE_LABELS[role as Role]
  return pair ? (isArabic ? pair[1] : pair[0]) : role
}
