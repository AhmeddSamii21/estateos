import { Role } from '@prisma/client'

/** Effective permissions used by the settings role matrix and its API. */
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

export type PermissionKey = (typeof PERMISSION_KEYS)[number]
export type RolePermissionMatrix = Record<Role, Record<PermissionKey, boolean>>

const all = (value: boolean): Record<PermissionKey, boolean> =>
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, value])) as Record<PermissionKey, boolean>

export const ROLE_PERMISSIONS: RolePermissionMatrix = {
  [Role.ADMIN]: all(true),
  [Role.MANAGER]: {
    ...all(true),
    'snapshots.export': false
  },
  [Role.ACCOUNTANT]: {
    ...all(false),
    'properties.view': true,
    'leads.view': true,
    'deals.view': true,
    'finance.view': true,
    'finance.manage': true,
    'reports.view': true,
    'activity.view': true
  },
  [Role.AGENT]: {
    ...all(false),
    'properties.view': true,
    'properties.manage': true,
    'leads.view': true,
    'leads.manage': true,
    'deals.view': true,
    'deals.manage': true,
    'activity.view': true
  },
  // Package 27: same operational permissions as an agent, but the API scope
  // is wider (own team + branch) and determined server-side.
  [Role.TEAM_LEAD]: {
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

export interface PermissionMatrixResponse {
  roles: Role[]
  permissions: PermissionKey[]
  matrix: RolePermissionMatrix
}

export function permissionMatrix(): PermissionMatrixResponse {
  return {
    roles: Object.values(Role),
    permissions: [...PERMISSION_KEYS],
    matrix: ROLE_PERMISSIONS
  }
}
