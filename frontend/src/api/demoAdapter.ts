/**
 * Standalone live-demo adapter.
 *
 * Every API call made by the Vue app (axios helpers, direct axios blob calls
 * and raw fetch downloads) is answered from an in-browser sample database
 * when demo mode is active. The database lives in localStorage, so creates,
 * edits and deletions survive page reloads during the demo session.
 */

import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { ref } from 'vue'
import {
  DEMO_ORG_ID,
  DEMO_PASSWORD,
  DEMO_STORAGE_KEY,
  DEMO_LOGIN_ACCOUNTS,
  demoCommissionStatements,
  loadDemoDatabase,
  resetDemoDatabase,
  saveDemoDatabase,
  type DemoDatabase,
  type DemoRow
} from './demoData'
import { buildAvailabilityMap } from '@/utils/liveMapCore.mjs'

const TOKEN_KEY = 'estateos.token'

function forcedDemoMode(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_DEMO_MODE === 'true') return true
  const params = new URLSearchParams(window.location.search)
  if (params.get('demo') === '1' || params.get('demo') === 'true') return true
  if (localStorage.getItem('estateos.forceDemo') === 'true') return true
  return window.location.hostname.endsWith('.github.io')
}

/** Reactive so the login screen can show the one-click demo action when active. */
export const demoMode = ref(forcedDemoMode())

let detection: Promise<void> | null = null
let database: DemoDatabase | null = null

function db(): DemoDatabase {
  if (!database) database = loadDemoDatabase()
  return database
}

function persist(): void {
  saveDemoDatabase(db())
}

/** Probe the local API once; a static host falls back to demo mode silently. */
function detectBackend(): Promise<void> {
  if (demoMode.value) return Promise.resolve()
  if (detection) return detection
  detection = new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      demoMode.value = true
      resolve()
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 1500)
    fetch('/api/health', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then((response) => response.text().then((text) => ({ response, text })))
      .then(({ response, text }) => {
        let healthy = response.ok
        try {
          const body = JSON.parse(text) as { success?: boolean; data?: unknown }
          healthy = healthy && Boolean(body.success && body.data)
        } catch {
          healthy = false
        }
        if (!healthy) demoMode.value = true
      })
      .catch(() => { demoMode.value = true })
      .finally(() => {
        window.clearTimeout(timer)
        resolve()
      })
  })
  return detection
}

export async function ensureDemoDecision(): Promise<void> {
  await detectBackend()
}

export function isDemoMode(): boolean {
  return demoMode.value
}

export function resetDemoSession(): void {
  database = resetDemoDatabase()
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
  demoMode.value = true
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface DemoResult {
  data: any
  status?: number
  contentType?: string
  extras?: Record<string, unknown>
  message?: string
}

type Params = Record<string, any>

function paramsFromUrl(url: string, configParams?: unknown): Params {
  const params: Params = {}
  try {
    const parsed = new URL(url, 'http://demo.local')
    parsed.searchParams.forEach((value, key) => { params[key] = value })
  } catch {
    // Relative URLs always parse against the dummy origin above.
  }
  if (configParams) {
    if (configParams instanceof URLSearchParams) {
      configParams.forEach((value, key) => { params[key] = value })
    } else if (typeof configParams === 'object') {
      Object.assign(params, configParams)
    }
  }
  return params
}

function stripApi(url: string): string {
  const path = new URL(url, 'http://demo.local').pathname
  return path.replace(/^\/api/, '').replace(/\/+$/, '') || '/'
}

function bodyFrom(config: InternalAxiosRequestConfig): any {
  const data = config.data
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return data }
  }
  return data
}

function idFrom(parts: string[], index: number): string {
  return decodeURIComponent(parts[index] || '')
}

function paginate<T>(rows: T[], params: Params): { rows: T[]; pagination: { page: number; limit: number; total: number; pages: number } } {
  const page = Math.max(1, Number(params.page) || 1)
  const limit = Math.min(500, Math.max(1, Number(params.limit) || Math.max(rows.length, 1)))
  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / limit)) }
  }
}

const IGNORED_PARAMS = new Set([
  'page', 'limit', 'cursor', 'language', 'sort', 'format', 'from', 'to', 'consolidated',
  'unread', 'category', 'q', 'search', 'keyword', 'officeId', 'branchId', 'teamId'
])

function matches(row: DemoRow, params: Params, extraIgnored: string[] = []): boolean {
  for (const [key, raw] of Object.entries(params)) {
    if (raw === '' || raw === undefined || raw === null) continue
    if (IGNORED_PARAMS.has(key) || extraIgnored.includes(key)) continue
    if (key === 'isActive' || key === 'enabled') {
      if (Boolean(row[key]) !== (raw === true || raw === 'true' || raw === 1 || raw === '1')) return false
      continue
    }
    if (key === 'featured' && String(row[key]) !== String(raw)) return false
    const value = row[key]
    if (Array.isArray(value)) {
      if (!value.some((item) => String(item?.id ?? item) === String(raw))) return false
    } else if (String(value ?? '') !== String(raw)) {
      // Multi-select filters may arrive as comma-separated values.
      const options = String(raw).split(',')
      if (!options.includes(String(value ?? ''))) return false
    }
  }
  return true
}

function textMatch(row: DemoRow, query: string, fields: string[]): boolean {
  const needle = query.toLowerCase()
  return fields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle))
}

function touch(row: DemoRow, patch: any): DemoRow {
  const updated = { ...row, ...(patch || {}), updatedAt: new Date().toISOString() }
  Object.assign(row, updated)
  return row
}

function nextId(prefix: string, rows: DemoRow[]): string {
  return `${prefix}-${Date.now().toString(36)}-${rows.length + 1}`
}

function currentUser(database: DemoDatabase): DemoRow {
  return database.users.find((user) => user.id === database.currentUserId) || database.users[0]
}

function userFromToken(database: DemoDatabase): DemoRow | null {
  let token: string | null = null
  try { token = localStorage.getItem(TOKEN_KEY) } catch { /* ignore */ }
  if (!token) return null
  if (token.startsWith('demo-') || token.startsWith('demo.')) return currentUser(database)
  return currentUser(database)
}

function publicUser(user: DemoRow): DemoRow {
  const { password: _password, ...rest } = user
  return rest
}

function demoPortalLink(entity: DemoRow, pathPrefix: string, regenerate = false): DemoRow {
  const token = regenerate || !entity.portalToken
    ? `demo-portal-${entity.id}-${Date.now().toString(36)}`
    : String(entity.portalToken)
  entity.portalToken = token
  entity.portalEnabled = true
  entity.portalLink = {
    enabled: true,
    token,
    url: `${window.location.origin}${import.meta.env.BASE_URL}${pathPrefix}${token}`
  }
  persist()
  return entity.portalLink
}

function propertyDetail(database: DemoDatabase, property: DemoRow): DemoRow {
  return {
    ...property,
    owner: database.owners.find((owner) => owner.id === property.ownerId) || null,
    assignedAgent: database.users.find((user) => user.id === property.assignedAgentId)
      ? publicUser(database.users.find((user) => user.id === property.assignedAgentId)!)
      : null,
    images: property.images || [],
    attachments: property.attachments || [],
    linkedDocuments: database.documents.filter((item) => item.propertyId === property.id),
    activities: database.activity.filter((item) => item.entityId === property.id),
    leads: database.leads.filter((item) => item.propertyId === property.id),
    appointments: database.appointments.filter((item) => item.propertyId === property.id),
    deals: database.deals.filter((item) => item.propertyId === property.id),
    expenses: database.expenses.filter((item) => item.propertyId === property.id),
    maintenanceRequests: database.maintenance.filter((item) => item.propertyId === property.id),
    _count: {
      leads: database.leads.filter((item) => item.propertyId === property.id).length,
      deals: database.deals.filter((item) => item.propertyId === property.id).length,
      maintenanceRequests: database.maintenance.filter((item) => item.propertyId === property.id).length
    }
  }
}

function propertyBoard(database: DemoDatabase): DemoResult {
  const statuses = ['AVAILABLE', 'UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET']
  const properties: Record<string, DemoRow[]> = {}
  for (const status of statuses) properties[status] = database.properties.filter((item) => item.status === status)
  return {
    data: {
      columns: statuses.map((status) => ({ status, label: status.replace(/_/g, ' '), count: properties[status].length })),
      properties,
      transitions: {
        AVAILABLE: ['UNDER_NEGOTIATION', 'PENDING', 'RESERVED', 'SOLD', 'RENTED', 'OFF_MARKET'],
        UNDER_NEGOTIATION: ['PENDING', 'RESERVED', 'SOLD', 'AVAILABLE'],
        PENDING: ['RESERVED', 'SOLD', 'AVAILABLE'],
        RESERVED: ['SOLD', 'AVAILABLE'],
        SOLD: [], RENTED: [], OFF_MARKET: ['AVAILABLE']
      }
    }
  }
}

function filterProperties(rows: DemoRow[], params: Params): DemoRow[] {
  const query = String(params.search || params.keyword || params.q || '').trim().toLowerCase()
  let result = rows.filter((row) => {
    if (query && !textMatch(row, query, ['title', 'referenceNumber', 'city', 'address', 'type', 'description'])) return false
    if (params.status && row.status !== params.status) return false
    if (params.type && row.type !== params.type) return false
    if (params.city && row.city !== params.city) return false
    if (params.country && row.country !== params.country) return false
    if (params.classification && row.classification !== params.classification) return false
    if (params.currency && row.currency !== params.currency) return false
    if (params.assignedAgentId && row.assignedAgentId !== params.assignedAgentId) return false
    if (params.minPrice && Number(row.price) < Number(params.minPrice)) return false
    if (params.maxPrice && Number(row.price) > Number(params.maxPrice)) return false
    if (params.bedrooms && Number(row.bedrooms) < Number(params.bedrooms)) return false
    if (params.minArea && Number(row.area) < Number(params.minArea)) return false
    if (params.maxArea && Number(row.area) > Number(params.maxArea)) return false
    if (params.minLatitude && Number(row.latitude) < Number(params.minLatitude)) return false
    if (params.maxLatitude && Number(row.latitude) > Number(params.maxLatitude)) return false
    if (params.minLongitude && Number(row.longitude) < Number(params.minLongitude)) return false
    if (params.maxLongitude && Number(row.longitude) > Number(params.maxLongitude)) return false
    if (params.featured === true || params.featured === 'true') {
      if (!row.featured) return false
    }
    if (params.availability === 'available' && !['AVAILABLE', 'UNDER_NEGOTIATION'].includes(row.status)) return false
    if (params.availability === 'unavailable' && ['AVAILABLE', 'UNDER_NEGOTIATION'].includes(row.status)) return false
    return true
  })
  const sort = String(params.sort || 'newest')
  result = [...result].sort((a, b) => {
    if (sort === 'price_asc') return Number(a.price) - Number(b.price)
    if (sort === 'price_desc') return Number(b.price) - Number(a.price)
    if (sort === 'area_desc') return Number(b.area) - Number(a.area)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  return result
}

function listUsers(database: DemoDatabase, params: Params): DemoRow[] {
  return database.users
    .filter((row) => matches(row, params, ['password', 'role', 'accountStatus', 'email']))
    .map((row) => ({
      ...publicUser(row),
      activeLeads: database.leads.filter((lead) => lead.assignedToId === row.id && lead.isActive).length,
      activeDeals: database.deals.filter((deal) => deal.userId === row.id && ['ACTIVE', 'PENDING'].includes(deal.status)).length
    }))
}

function paymentAgingSummary(database: DemoDatabase) {
  const buckets = ['CURRENT', '1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'PAID']
  return Object.fromEntries(buckets.map((bucket) => {
    const rows = database.payments.filter((payment) => payment.aging?.bucket === bucket)
    return [bucket, {
      count: rows.length,
      amount: String(rows.reduce((sum, row) => sum + Number(row.baseAmount || row.amount), 0)),
      baseAmount: String(rows.reduce((sum, row) => sum + Number(row.baseAmount || row.amount), 0))
    }]
  }))
}

function leaseRenewals(database: DemoDatabase): DemoRow[] {
  return database.deals
    .filter((deal) => deal.leaseEndAt)
    .map((deal) => {
      const daysUntil = Math.ceil((new Date(deal.leaseEndAt).getTime() - Date.now()) / 86_400_000)
      const notice = Number(deal.renewalNoticeDays || 30)
      return {
        ...deal,
        noticeDays: notice,
        daysUntil,
        state: daysUntil < 0 ? 'expired' : daysUntil <= notice ? 'due' : 'upcoming'
      }
    })
}

function unitGrid(database: DemoDatabase, params: Params): DemoResult {
  const arabic = params.language === 'ar'
  const projects = [
    { key: 'skyline', name: 'Skyline Residences', nameAr: 'مساكن سكايلاين', building: 'Tower A', buildingAr: 'البرج أ' },
    { key: 'garden', name: 'Garden District', nameAr: 'منطقة الحدائق', building: 'Building 2', buildingAr: 'المبنى ٢' },
    { key: 'marina', name: 'Marina Views', nameAr: 'إطلالات المارينا', building: 'Block B', buildingAr: 'الكتلة ب' }
  ]
  const statuses: Array<[string, string, string, string]> = [
    ['AVAILABLE', arabic ? 'متاحة' : 'Available', '#22c55e', 'available'],
    ['RESERVED', arabic ? 'محجوزة' : 'Reserved', '#f59e0b', 'reserved'],
    ['SOLD', arabic ? 'مباعة' : 'Sold', '#ef4444', 'sold'],
    ['RENTED', arabic ? 'مؤجرة' : 'Rented', '#6366f1', 'rented']
  ]
  const groups = projects.map((project, projectIndex) => {
    const floors = [1, 2, 3].map((floorNumber) => {
      const units = Array.from({ length: 4 }, (_, unitIndex) => {
        const index = projectIndex * 12 + (floorNumber - 1) * 4 + unitIndex
        const property = database.properties[index % database.properties.length]
        const seedStatus = statuses[(index + projectIndex) % statuses.length]
        return {
          id: `demo-unit-${index + 1}`,
          label: `${project.key.toUpperCase()}-${floorNumber}${String.fromCharCode(65 + unitIndex)}`,
          title: arabic ? `${project.nameAr} — وحدة ${floorNumber}${String.fromCharCode(65 + unitIndex)}` : `${project.name} — Unit ${floorNumber}${String.fromCharCode(65 + unitIndex)}`,
          status: seedStatus[0],
          color: seedStatus[2],
          price: Number(property.price) / 10 + unitIndex * 2500,
          currency: property.currency,
          bedrooms: 1 + (unitIndex % 4),
          type: property.type,
          unitNumber: `${floorNumber}${String.fromCharCode(65 + unitIndex)}`
        }
      }).filter((unit) => !params.status || unit.status === params.status)
      return { floor: floorNumber, label: arabic ? `الطابق ${floorNumber}` : `Floor ${floorNumber}`, units }
    }).filter((floor) => floor.units.length)
    return {
      project: params.language === 'ar' ? project.nameAr : project.name,
      building: params.language === 'ar' ? project.buildingAr : project.building,
      floors
    }
  }).filter((group) => !params.project || group.project === params.project)
  const flat = groups.flatMap((group) => group.floors.flatMap((floor) => floor.units))
  const counts = Object.fromEntries(statuses.map(([status]) => [status, flat.filter((unit) => unit.status === status).length]))
  return {
    data: {
      groups,
      counts,
      total: flat.length,
      legend: statuses.map(([key, label, color]) => ({ key, label, color }))
    }
  }
}

function leaderboard(database: DemoDatabase, params: Params): DemoResult {
  const period = String(params.period || 'month')
  const factor = period === 'year' ? 12 : period === 'quarter' ? 3 : 1
  const rows = database.users
    .filter((user) => ['AGENT', 'TEAM_LEAD', 'MANAGER'].includes(user.role))
    .map((user) => {
      const deals = database.deals.filter((deal) => deal.userId === user.id)
      const value = deals.reduce((sum, deal) => sum + Number(deal.amount), 0) * factor
      const target = Number(user.monthlyTargetAmount || 0) * factor
      const attainment = target ? Number((value / target * 100).toFixed(1)) : null
      const status: string = attainment === null ? 'NO_TARGET'
        : attainment >= 100 ? 'EXCEEDED'
          : attainment >= 80 ? 'ON_TRACK'
            : attainment >= 50 ? 'NEAR' : 'BELOW'
      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName || ''}`.trim(),
        role: user.role,
        target: target ? String(target) : null,
        value: String(value),
        attainment,
        status,
        dealCount: deals.length,
        wonLeadCount: database.leads.filter((lead) => lead.assignedToId === user.id && lead.status === 'WON').length,
        completedAppointmentCount: database.appointments.filter((item) => item.userId === user.id && item.status === 'COMPLETED').length,
        rank: 0
      }
    })
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((row, index) => ({ ...row, rank: index + 1 }))
  const now = new Date()
  return {
    data: {
      period,
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: now.toISOString(),
      scope: 'ALL',
      rows
    }
  }
}

function reportSummary(database: DemoDatabase): DemoResult {
  const grouped = (rows: DemoRow[], key: string) => {
    const map = new Map<string, { count: number; sum: number }>()
    for (const row of rows) {
      const name = String(row[key] ?? 'UNKNOWN')
      const current = map.get(name) || { count: 0, sum: 0 }
      current.count += 1
      current.sum += Number(row.amount || row.price || 0)
      map.set(name, current)
    }
    return Array.from(map, ([name, value]) => ({
      [key]: name, _count: { _all: value.count }, _sum: { amount: String(value.sum) }
    }))
  }
  const currencyTotals = (rows: DemoRow[]) => {
    const map = new Map<string, number>()
    for (const row of rows) map.set(row.currency, (map.get(row.currency) || 0) + Number(row.amount || 0))
    return Array.from(map, ([currency, amount]) => ({ currency, amount: String(amount), baseAmount: String(amount) }))
  }
  const uncontacted = database.leads.filter((lead) => !lead.lastContactedAt && lead.status === 'NEW')
  return {
    data: {
      properties: {
        total: database.properties.length,
        available: database.properties.filter((item) => item.status === 'AVAILABLE').length,
        unavailable: database.properties.filter((item) => item.status !== 'AVAILABLE').length,
        byStatus: grouped(database.properties, 'status'),
        byType: grouped(database.properties, 'type'),
        byCity: grouped(database.properties, 'city')
      },
      deals: {
        total: database.deals.length,
        active: database.deals.filter((item) => item.status === 'ACTIVE').length,
        completed: database.deals.filter((item) => item.status === 'COMPLETED').length
      },
      finance: {
        payments: currencyTotals(database.payments),
        paymentAging: paymentAgingSummary(database),
        expenses: currencyTotals(database.expenses),
        commissions: currencyTotals(database.commissions),
        paymentTotalBase: String(database.payments.reduce((sum, row) => sum + Number(row.amount), 0)),
        expenseTotalBase: String(database.expenses.reduce((sum, row) => sum + Number(row.amount), 0)),
        fx: { baseCurrency: 'USD', convertedPaymentTotal: null, missingCurrencies: [], hasRates: true }
      },
      maintenance: {
        byStatus: grouped(database.maintenance, 'status'),
        totalCost: String(database.maintenance.reduce((sum, row) => sum + Number(row.cost || 0), 0))
      },
      funnel: {
        leads: {
          total: database.leads.length,
          new: database.leads.filter((lead) => lead.status === 'NEW').length,
          engaged: database.leads.filter((lead) => ['CONTACTED', 'QUALIFIED'].includes(lead.status)).length,
          viewing: database.leads.filter((lead) => lead.status === 'VIEWING').length,
          won: database.leads.filter((lead) => lead.status === 'WON').length
        },
        deals: { total: database.deals.length, closed: database.deals.filter((deal) => deal.status === 'COMPLETED').length },
        stages: ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'WON'].map((stage, index, all) => {
          const count = database.leads.filter((lead) => lead.status === stage).length
          const previous = index ? database.leads.filter((lead) => lead.status === all[index - 1]).length : count
          return { stage, label: stage.replace(/_/g, ' '), count, conversionRate: previous ? count / previous : 1 }
        })
      },
      sla: {
        uncontactedCount: uncontacted.length,
        uncontactedLeads: uncontacted.map((lead) => ({
          id: lead.id, firstName: lead.firstName, lastName: lead.lastName, email: lead.email,
          phone: lead.phone, createdAt: lead.createdAt, ageHours: 36
        }))
      }
    }
  }
}

function reportTeam(database: DemoDatabase): DemoResult {
  const currencies = Array.from(new Set(database.deals.map((deal) => deal.currency)))
  const deals = database.users.map((user) => {
    const userDeals = database.deals.filter((deal) => deal.userId === user.id)
    return currencies.map((currency) => ({
      userId: user.id, currency,
      count: userDeals.filter((deal) => deal.currency === currency).length,
      value: String(userDeals.filter((deal) => deal.currency === currency).reduce((sum, deal) => sum + Number(deal.amount), 0))
    }))
  }).flat().filter((row) => row.count > 0)
  return {
    data: {
      deals,
      leads: database.users.map((user) => ({ userId: user.id, count: database.leads.filter((lead) => lead.assignedToId === user.id).length })),
      appointments: database.users.map((user) => ({ userId: user.id, count: database.appointments.filter((item) => item.userId === user.id).length })),
      funnel: (reportSummary(database).data as DemoRow).funnel,
      sla: (reportSummary(database).data as DemoRow).sla
    }
  }
}

function csvText(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

function simpleCsvPreview(csv: string, headers: readonly string[]): DemoResult {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim())
  const headerRow = lines[0] ? lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')) : [...headers]
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
    const values = Object.fromEntries(headerRow.map((header, cellIndex) => [header, cells[cellIndex] ?? '']))
    return { row: index + 2, values, errors: [], valid: true }
  })
  return {
    data: {
      preview: {
        headers: headerRow,
        rows,
        validCount: rows.length,
        invalidCount: 0
      }
    }
  }
}

function globalSearch(database: DemoDatabase, params: Params): DemoResult {
  const query = String(params.q || '').trim().toLowerCase()
  const match = (row: DemoRow, fields: string[]) => !query || textMatch(row, query, fields)
  const properties = database.properties.filter((row) => match(row, ['title', 'referenceNumber', 'city', 'address']))
    .map((row) => ({ id: row.id, title: row.title, type: 'PROPERTY', route: `/properties/${row.id}`, details: { city: row.city, price: String(row.price) } }))
  const owners = database.owners.filter((row) => match(row, ['displayName', 'email', 'companyName']))
    .map((row) => ({ id: row.id, title: row.displayName, type: 'OWNER', route: '/owners', details: { name: row.displayName, email: row.email } }))
  const leads = database.leads.filter((row) => match(row, ['firstName', 'lastName', 'email', 'phone']))
    .map((row) => ({ id: row.id, title: `${row.firstName} ${row.lastName || ''}`.trim(), type: 'LEAD', route: `/leads/${row.id}`, details: { name: `${row.firstName} ${row.lastName || ''}`, email: row.email } }))
  const deals = database.deals.filter((row) => match(row, ['referenceNumber', 'type', 'status']))
    .map((row) => ({ id: row.id, title: row.referenceNumber || row.id, type: 'DEAL', route: `/deals/${row.id}`, details: { referenceNumber: row.referenceNumber, amount: String(row.amount) } }))
  const documents = database.documents.filter((row) => match(row, ['name', 'originalName', 'category']))
    .map((row) => ({ id: row.id, title: row.name, type: 'DOCUMENT', route: '/documents', details: { name: row.name, category: row.category } }))
  return {
    data: {
      success: true,
      data: { properties, owners, leads, deals, documents, total: properties.length + owners.length + leads.length + deals.length + documents.length },
      total: properties.length + owners.length + leads.length + deals.length + documents.length
    }
  }
}

function contractPreview(database: DemoDatabase, template: DemoRow, body: any): DemoResult {
  const deal = database.deals.find((item) => item.id === body?.dealId) || database.deals[0]
  const language = body?.language === 'ar' ? 'ar' : 'en'
  const raw = language === 'ar' ? (template.bodyAr || template.body) : template.body
  const values: Record<string, string> = {
    client_name: deal?.lead?.firstName || 'Client',
    agent_name: deal?.user?.firstName || 'Agent',
    deal_reference: deal?.referenceNumber || 'DEMO-DEAL',
    due_date: deal?.dueAt ? String(deal.dueAt).slice(0, 10) : '—',
    property_title: deal?.property?.title || 'Property',
    property_price: String(deal?.amount || 0),
    organization_name: 'EstateOS Demo Realty'
  }
  const missingTokens: string[] = []
  const rendered = String(raw || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_token, name: string) => {
    if (values[name] === undefined) { missingTokens.push(name); return `{{${name}}}` }
    return values[name]
  })
  return {
    data: {
      title: language === 'ar' ? template.nameAr || template.name : template.name,
      body: rendered,
      language,
      direction: language === 'ar' ? 'rtl' : 'ltr',
      missingTokens,
      hasArabicBody: Boolean(template.bodyAr),
      dealId: deal?.id || '',
      templateId: template.id,
      version: template.version,
      dealReference: deal?.referenceNumber
    }
  }
}

function collectionFor(root: string, second: string): { key: keyof DemoDatabase; prefix: string } | null {
  const map: Record<string, { key: keyof DemoDatabase; prefix: string }> = {
    '/appointments': { key: 'appointments', prefix: 'demo-appointment' },
    '/maintenance': { key: 'maintenance', prefix: 'demo-maintenance' },
    '/documents': { key: 'documents', prefix: 'demo-document' },
    '/users': { key: 'users', prefix: 'demo-user' },
    '/owners': { key: 'owners', prefix: 'demo-owner' },
    '/finance/expenses': { key: 'expenses', prefix: 'demo-expense' },
    '/finance/commissions': { key: 'commissions', prefix: 'demo-commission' },
    '/finance/payments': { key: 'payments', prefix: 'demo-payment' },
    '/referrals/partners': { key: 'referralPartners', prefix: 'demo-partner' },
    '/referrals/splits': { key: 'referralSplits', prefix: 'demo-split' },
    '/contracts/templates': { key: 'contractTemplates', prefix: 'demo-template' },
    '/follow-ups/rules': { key: 'followUpRules', prefix: 'demo-rule' },
    '/follow-ups/tasks': { key: 'followUpTasks', prefix: 'demo-task' },
    '/hierarchy/branches': { key: 'branches', prefix: 'demo-branch' },
    '/hierarchy/teams': { key: 'teams', prefix: 'demo-team' }
  }
  return map[`/${root}${second ? `/${second}` : ''}`] || null
}

function resourceList(rows: DemoRow[], params: Params, extras: Record<string, (row: DemoRow) => unknown> = {}): DemoResult {
  const filtered = rows.filter((row) => matches(row, params))
  const result = paginate(filtered, params)
  const data = result.rows.map((row) => {
    const output = { ...row }
    for (const [key, value] of Object.entries(extras)) output[key] = value(row)
    return output
  })
  return { data, extras: { pagination: result.pagination } }
}

/** Shared portal-token routes used by lead, deal and owner detail panels. */
function handlePortalRoute(
  method: string,
  second: string,
  third: string,
  id: string,
  rows: DemoRow[],
  pathPrefix: string
): DemoResult | null {
  if (!second || !['portal-link', 'portal-token', 'portal-token/regenerate', 'portal-token/revoke'].includes(third)) return null
  const entity = rows.find((row) => row.id === id)
  if (!entity) return { status: 404, data: { error: { message: 'Record not found in demo data.' } } }
  if (third === 'portal-link' && method === 'GET') {
    return { data: entity.portalLink || demoPortalLink(entity, pathPrefix) }
  }
  if (third === 'portal-token/revoke') {
    const link = { enabled: false, token: null, url: null }
    entity.portalEnabled = false
    entity.portalToken = null
    entity.portalLink = link
    persist()
    return { data: link }
  }
  if (third === 'portal-token' && method === 'DELETE') {
    const link = { enabled: false, token: null, url: null }
    entity.portalEnabled = false
    entity.portalToken = null
    entity.portalLink = link
    persist()
    return { data: link }
  }
  return { data: demoPortalLink(entity, pathPrefix, third === 'portal-token/regenerate') }
}

/** Main demo dispatcher. Returns a plain result object; never throws on missing data. */
function handleDemoRequest(method: string, url: string, params: Params, body: any): DemoResult {
  const database = db()
  const path = stripApi(url)
  const parts = path.split('/').filter(Boolean)
  const [root = '', second = '', third = '', fourth = '', fifth = ''] = parts
  const id = idFrom(parts, 1)

  if (root === 'health') return { data: { status: 'ok', demo: true, database: 'in-memory' } }

  // -- Authentication -------------------------------------------------------
  if (root === 'auth') {
    if (path === '/auth/login' && method === 'POST') {
      const email = String(body?.email || '').toLowerCase()
      const user = database.users.find((item) => String(item.email).toLowerCase() === email)
        || (email.includes('accountant') ? database.users.find((item) => item.role === 'ACCOUNTANT')
          : email.includes('teamlead') || email.includes('team-lead') ? database.users.find((item) => item.role === 'TEAM_LEAD')
            : email.includes('manager') ? database.users.find((item) => item.role === 'MANAGER')
              : email.includes('agent') && !email.includes('manager') ? database.users.find((item) => item.role === 'AGENT')
                : currentUser(database))
      database.currentUserId = user?.id || database.currentUserId
      persist()
      try { localStorage.setItem(TOKEN_KEY, `demo-token-${database.currentUserId}`) } catch { /* ignore */ }
      return { data: { ...publicUser(user || currentUser(database)), token: `demo-token-${database.currentUserId}` } }
    }
    if (path === '/auth/register' && method === 'POST') {
      const user = {
        id: nextId('demo-user', database.users),
        organizationId: DEMO_ORG_ID,
        email: String(body?.email || 'demo.new@estateos.local'),
        firstName: String(body?.firstName || 'Demo'),
        role: 'AGENT',
        accountStatus: 'ACTIVE',
        isActive: true,
        preferredLang: 'en',
        loginCount: 0,
        createdAt: new Date().toISOString()
      }
      database.users.push(user)
      persist()
      try { localStorage.setItem(TOKEN_KEY, `demo-token-${user.id}`) } catch { /* ignore */ }
      return { data: { ...publicUser(user), token: `demo-token-${user.id}` } }
    }
    if (path === '/auth/me') {
      const user = userFromToken(database)
      if (!user) return { status: 401, data: { error: { message: 'Demo session not started.' } } }
      return { data: publicUser(user) }
    }
    if (path === '/auth/me' && method === 'PATCH') {
      return { data: publicUser(touch(currentUser(database), body)) }
    }
    if (path === '/auth/change-password') return { data: { success: true } }
    if (path === '/auth/logout') return { data: { success: true } }
  }

  // -- Notifications --------------------------------------------------------
  if (root === 'notifications') {
    if (path === '/notifications/unread-count') {
      return { data: { count: database.notifications.filter((item) => !item.isRead).length } }
    }
    if (path === '/notifications/read-all' && method === 'PATCH') {
      database.notifications.forEach((item) => { item.isRead = true; item.readAt = new Date().toISOString() })
      persist()
      return { data: { updated: database.notifications.length } }
    }
    if (second && third === 'read' && method === 'PATCH') {
      const target = database.notifications.find((item) => item.id === second)
      if (target) { target.isRead = true; target.readAt = new Date().toISOString(); persist() }
      return { data: target || {} }
    }
    if (method === 'GET') {
      let rows = database.notifications.filter((row) => matches(row, params))
      if (params.unread === true || params.unread === 'true') rows = rows.filter((row) => !row.isRead)
      if (params.category) rows = rows.filter((row) => row.type === params.category || row.entityType === params.category)
      const limit = Number(params.limit) || rows.length
      return {
        data: rows.slice(0, limit),
        extras: { unreadCount: database.notifications.filter((row) => !row.isRead).length }
      }
    }
  }

  // -- Properties -----------------------------------------------------------
  if (root === 'properties') {
    if (path === '/properties/bulk' && method === 'POST') {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : []
      const action = String(body?.action || 'status')
      const results = ids.map((itemId) => {
        const property = database.properties.find((row) => row.id === itemId)
        if (!property) return { id: itemId, success: false, message: 'Not found' }
        if (action === 'status') property.status = String(body.status || property.status)
        if (action === 'assign') property.assignedAgentId = body.assignedAgentId || null
        if (action === 'delete') database.properties = database.properties.filter((row) => row.id !== itemId)
        touch(property, {})
        return { id: itemId, success: true, message: 'OK' }
      })
      persist()
      return { data: { action, total: ids.length, succeeded: results.filter((row) => row.success).length, failed: results.filter((row) => !row.success).length, results } }
    }
    if (path === '/properties/import' && method === 'POST') {
      if (body?.dryRun === true || body?.dryRun === 'true') {
        return simpleCsvPreview(String(body?.csv || ''), ['referenceNumber', 'title', 'type', 'status', 'city', 'price', 'currency'])
      }
      return { data: { created: 0 } }
    }
    if (path === '/properties/board') return propertyBoard(database)
    if (path === '/properties/search' || path === '/properties') {
      const filtered = filterProperties(database.properties, params)
      const result = paginate(filtered, params)
      return { data: result.rows, extras: { pagination: result.pagination } }
    }
    if (method === 'POST') {
      const property = {
        id: nextId('demo-property', database.properties),
        organizationId: DEMO_ORG_ID,
        referenceNumber: String(body?.referenceNumber || `EST-${1100 + database.properties.length}`),
        title: String(body?.title || 'Untitled property'),
        type: String(body?.type || 'APARTMENT'),
        status: String(body?.status || 'AVAILABLE'),
        classification: String(body?.classification || 'RESIDENTIAL'),
        currency: String(body?.currency || 'USD'),
        price: Number(body?.price || 0),
        city: String(body?.city || 'Cairo'),
        address: String(body?.address || ''),
        bedrooms: Number(body?.bedrooms || 0),
        bathrooms: Number(body?.bathrooms || 0),
        area: Number(body?.area || 0),
        areaUnit: String(body?.areaUnit || 'SQ_M'),
        condition: String(body?.condition || 'GOOD'),
        features: String(body?.features || ''),
        paymentTerms: String(body?.paymentTerms || ''),
        negotiable: Boolean(body?.negotiable),
        featured: Boolean(body?.featured),
        ownerId: body?.ownerId || null,
        assignedAgentId: body?.assignedAgentId || null,
        latitude: body?.latitude || null,
        longitude: body?.longitude || null,
        images: [], attachments: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
      database.properties.unshift(property)
      persist()
      return { data: property }
    }
    const property = database.properties.find((row) => row.id === id)
    if (!property) return { status: 404, data: { error: { message: 'Property not found in demo data.' } } }
    if (second === 'share-summary' && method === 'POST') return { data: { success: true } }
    if (second === 'share-link') {
      if (method === 'DELETE') { property.shareLink = null; persist(); return { data: { enabled: false, token: null, url: null, expiresAt: null, createdAt: null } } }
      const token = property.shareLink?.token || `demo-share-${property.id}`
      const link = { enabled: true, token, url: `${window.location.origin}${import.meta.env.BASE_URL}p/${token}`, expiresAt: null, createdAt: new Date().toISOString() }
      property.shareLink = link
      persist()
      return { data: link }
    }
    if (second === 'status' && method === 'PATCH') { touch(property, { status: body?.status }); persist(); return { data: property } }
    // Package 44: coordinate/masterplan pin update. Live map status changes
    // reuse the existing /properties/:id/status route above.
    if (third === 'coordinates' && method === 'PATCH') {
      const fields = ['latitude', 'longitude', 'cityArea', 'masterplanImageUrl', 'mapX', 'mapY', 'unitLatitude', 'unitLongitude']
      const patch: DemoRow = {}
      for (const field of fields) if (body?.[field] !== undefined) patch[field] = body[field]
      touch(property, patch)
      persist()
      return { data: property, message: 'Property coordinates updated successfully' }
    }
    if (second === 'duplicate-draft') {
      const { id: _id, images: _images, attachments: _attachments, ...draft } = property
      return { data: { ...draft, title: `${property.title} (copy)`, referenceNumber: '' } }
    }
    if (second === 'attachments') {
      if (method === 'GET') return { data: property.attachments || [] }
      if (method === 'POST') {
        const attachment = {
          id: nextId('demo-attachment', database.properties),
          name: String(body?.name || 'Attachment'),
          url: '#', contentUrl: '#',
          kind: String(body?.kind || 'FLOORPLAN'),
          mimeType: 'application/pdf', originalName: String(body?.originalName || 'file.pdf'),
          size: 120000, sortOrder: 0
        }
        property.attachments = [...(property.attachments || []), attachment]
        persist()
        return { data: attachment }
      }
      if (method === 'DELETE') {
        const attachmentId = idFrom(parts, 2)
        property.attachments = (property.attachments || []).filter((item: DemoRow) => item.id !== attachmentId)
        persist()
        return { data: { success: true } }
      }
    }
    if (second === 'images') {
      if (third && fourth === 'content') {
        return { contentType: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#e0e7ff"/><text x="40" y="210" font-size="28" font-family="sans-serif" fill="#4338ca">EstateOS demo image</text></svg>' }
      }
      if (method === 'GET') return { data: property.images || [] }
      if (method === 'POST') {
        const image = {
          id: nextId('demo-image', database.properties),
          propertyId: property.id,
          url: `https://placehold.co/640x400/6366f1/ffffff?text=${encodeURIComponent(property.title)}`,
          contentUrl: `https://placehold.co/640x400/6366f1/ffffff?text=${encodeURIComponent(property.title)}`,
          caption: 'Demo image', originalName: 'demo.jpg', mimeType: 'image/jpeg', size: 1024,
          isPrimary: !(property.images || []).length, sortOrder: (property.images || []).length
        }
        property.images = [...(property.images || []), image]
        persist()
        return { data: image }
      }
      if (method === 'PATCH' && third === 'reorder') {
        const orderedIds: string[] = Array.isArray(body?.orderedIds) ? body.orderedIds : []
        property.images = (property.images || []).map((image: DemoRow) => ({ ...image, sortOrder: orderedIds.indexOf(image.id) }))
        persist()
        return { data: property.images }
      }
      if (method === 'PATCH') {
        const imageId = idFrom(parts, 2)
        property.images = (property.images || []).map((image: DemoRow) => ({ ...image, isPrimary: image.id === imageId }))
        persist()
        return { data: { success: true } }
      }
      if (method === 'DELETE') {
        const imageId = idFrom(parts, 2)
        property.images = (property.images || []).filter((image: DemoRow) => image.id !== imageId)
        persist()
        return { data: { success: true } }
      }
    }
    if (method === 'GET') return { data: propertyDetail(database, property) }
    if (method === 'PATCH') { touch(property, body); persist(); return { data: property } }
    if (method === 'DELETE') {
      database.properties = database.properties.filter((row) => row.id !== id)
      persist()
      return { data: { success: true } }
    }
  }

  // -- Leads ----------------------------------------------------------------
  if (root === 'leads') {
    if (path === '/leads/import' && method === 'POST') {
      if (body?.dryRun === true || body?.dryRun === 'true') return simpleCsvPreview(String(body?.csv || ''), ['firstName', 'lastName', 'email', 'phone', 'status', 'source'])
      return { data: { created: 0 } }
    }
    if (third === 'matches') {
      const lead = database.leads.find((row) => row.id === id)
      const matchesList = database.properties.slice(0, 5).map((property) => ({
        score: 60 + Math.round(Math.random() * 35),
        reasons: ['Matching city', 'Within budget', 'Correct property type'],
        property
      }))
      return { data: { leadId: id, criteria: lead || {}, matches: matchesList } }
    }
    if (third === 'recompute-priority') {
      const lead = database.leads.find((row) => row.id === id)
      if (lead) { lead.priorityScore = 78; lead.priorityTier = 'HIGH'; persist() }
      return { data: lead || {} }
    }
    if (third === 'follow-ups' && method === 'POST') return { data: { id: nextId('demo-note', database.followUpTasks), created: true } }
    const leadPortal = handlePortalRoute(method, second, third, id, database.leads, 'client-portal/')
    if (leadPortal) return leadPortal
    if (!second) {
      if (method === 'POST') {
        const lead = {
          id: nextId('demo-lead', database.leads),
          organizationId: DEMO_ORG_ID,
          firstName: String(body?.firstName || 'New'),
          lastName: String(body?.lastName || 'Lead'),
          email: body?.email || null, phone: body?.phone || null,
          status: String(body?.status || 'NEW'), source: String(body?.source || 'Demo'),
          priorityScore: 70, priorityTier: 'HIGH',
          budgetMin: body?.budgetMin || null, budgetMax: body?.budgetMax || null,
          preferredType: body?.preferredType || null, preferredCity: body?.preferredCity || null,
          isActive: true, followUpNotes: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }
        database.leads.unshift(lead)
        persist()
        return { data: lead }
      }
      return resourceList(database.leads, params)
    }
    const lead = database.leads.find((row) => row.id === id)
    if (!lead) return { status: 404, data: { error: { message: 'Lead not found in demo data.' } } }
    if (method === 'PATCH') { touch(lead, body); persist(); return { data: lead } }
    if (method === 'DELETE') { database.leads = database.leads.filter((row) => row.id !== id); persist(); return { data: { success: true } } }
    return { data: lead }
  }

  // -- Deals ----------------------------------------------------------------
  if (root === 'deals') {
    if (path === '/deals/lease-renewals') return { data: leaseRenewals(database) }
    if (!second) {
      if (method === 'POST') {
        const deal = {
          id: nextId('demo-deal', database.deals),
          organizationId: DEMO_ORG_ID,
          referenceNumber: String(body?.referenceNumber || `DEAL-${2400 + database.deals.length}`),
          type: String(body?.type || 'SALE'), status: String(body?.status || 'DRAFT'),
          propertyId: String(body?.propertyId || database.properties[0]?.id || ''),
          leadId: body?.leadId || null,
          userId: String(body?.userId || database.currentUserId),
          amount: Number(body?.amount || 0), currency: String(body?.currency || 'USD'),
          closingChecklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }
        database.deals.unshift(deal)
        persist()
        return { data: deal }
      }
      return resourceList(database.deals, params)
    }
    const deal = database.deals.find((row) => row.id === id)
    if (!deal) return { status: 404, data: { error: { message: 'Deal not found in demo data.' } } }
    const dealPortal = handlePortalRoute(method, second, third, id, database.deals, 'client-portal/')
    if (dealPortal) return dealPortal
    if (third === 'checklist') {
      const items = deal.closingChecklist || []
      const progress = { completed: items.filter((item: DemoRow) => item.isCompleted).length, total: items.length, isComplete: items.length > 0 && items.every((item: DemoRow) => item.isCompleted), items }
      if (method === 'PATCH') {
        const itemKey = idFrom(parts, 3) || body?.itemKey
        deal.closingChecklist = items.map((item: DemoRow) => item.itemKey === itemKey || item.id === itemKey ? { ...item, isCompleted: Boolean(body?.isCompleted), completedAt: new Date().toISOString() } : item)
        persist()
        return { data: { progress: { ...progress, items: deal.closingChecklist } } }
      }
      return { data: progress }
    }
    if (third === 'installments' && method === 'POST') {
      const count = Math.max(1, Number(body?.installmentCount || 4))
      const created = Array.from({ length: count }, (_, index) => ({ id: `demo-installment-${deal.id}-${index + 1}` }))
      for (const row of created) database.payments.push({ id: row.id, dealId: deal.id, amount: Number(deal.amount) / count, currency: deal.currency, status: 'PENDING', createdAt: new Date().toISOString() })
      persist()
      return { data: { payments: created, installmentCount: count } }
    }
    if (method === 'PATCH') { touch(deal, body); persist(); return { data: deal } }
    if (method === 'DELETE') { database.deals = database.deals.filter((row) => row.id !== id); persist(); return { data: { success: true } } }
    return { data: {
      ...deal,
      payments: database.payments.filter((payment) => payment.dealId === deal.id),
      commissions: database.commissions.filter((commission) => commission.dealId === deal.id),
      expenses: database.expenses.filter((expense) => expense.dealId === deal.id),
      documents: database.documents.filter((document) => document.dealId === deal.id)
    } }
  }

  // -- Finance --------------------------------------------------------------
  if (root === 'finance') {
    if (path === '/finance/payments/aging') return { data: { summary: paymentAgingSummary(database) } }
    if (path === '/finance/payments/summary') {
      const deal = database.deals.find((row) => row.id === params.dealId)
      const payments = database.payments.filter((row) => row.dealId === params.dealId)
      const received = payments.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + Number(row.amount), 0)
      return { data: { dealAmount: String(deal?.amount || 0), dealBaseAmount: String(deal?.amount || 0), currency: deal?.currency || 'USD', received: String(received), outstanding: String(Math.max(0, Number(deal?.amount || 0) - received)), payments: payments.length, aging: paymentAgingSummary(database) } }
    }
    if (path === '/finance/commission-statements') return { data: demoCommissionStatements(database) }
    if (second === 'payments' && method === 'POST') {
      const payment = { id: nextId('demo-payment', database.payments), organizationId: DEMO_ORG_ID, ...body, createdAt: new Date().toISOString(), aging: { bucket: 'CURRENT', daysPastDue: 0 } }
      database.payments.push(payment)
      persist()
      return { data: payment }
    }
    if (second === 'commissions' && third && fourth === 'status' && method === 'PATCH') {
      const commission = database.commissions.find((row) => row.id === third)
      if (commission) { commission.status = body?.status || commission.status; persist() }
      return { data: commission || {} }
    }
  }

  // -- Package 44: live availability maps -----------------------------------
  if (root === 'maps') {
    if (second === 'availability' && method === 'GET') {
      const filters = {
        project: params.project || '',
        status: String(params.status || '').toUpperCase(),
        type: String(params.type || '').toUpperCase(),
        minPrice: params.minPrice === undefined || params.minPrice === '' ? undefined : Number(params.minPrice),
        maxPrice: params.maxPrice === undefined || params.maxPrice === '' ? undefined : Number(params.maxPrice)
      }
      const result = buildAvailabilityMap(database.properties, {
        language: params.language === 'ar' ? 'ar' : 'en',
        filters
      })
      return {
        data: {
          ...result,
          generatedAt: new Date().toISOString(),
          filters: {
            project: filters.project || null,
            status: filters.status || null,
            type: filters.type || null,
            minPrice: filters.minPrice ?? null,
            maxPrice: filters.maxPrice ?? null
          }
        }
      }
    }
  }

  // -- Inventory / leaderboard / referrals / contracts ----------------------
  if (root === 'inventory') {
    if (second === 'units' && method === 'PATCH') return { data: { success: true, id } }
    return unitGrid(database, params)
  }
  if (root === 'leaderboard') return leaderboard(database, params)
  if (root === 'referrals') {
    if (path === '/referrals/summary') {
      const byPartner = database.referralPartners.map((partner) => {
        const splits = database.referralSplits.filter((split) => split.partnerId === partner.id)
        return { partnerId: partner.id, partnerName: partner.name, currency: 'USD', total: String(splits.reduce((sum, split) => sum + Number(split.amount), 0)), count: splits.length }
      })
      return { data: { splitCount: database.referralSplits.length, byPartner } }
    }
    if (third === 'status' && method === 'PATCH') {
      const split = database.referralSplits.find((row) => row.id === second)
      if (split) { split.status = body?.status || split.status; persist() }
      return { data: split || {} }
    }
  }
  if (root === 'contracts' && second === 'templates' && third && fourth === 'render' && method === 'POST') {
    const template = database.contractTemplates.find((row) => row.id === third) || database.contractTemplates[0]
    return contractPreview(database, template, body)
  }

  // -- Follow-ups -----------------------------------------------------------
  if (root === 'follow-ups') {
    if (path === '/follow-ups/summary') {
      return { data: {
        rules: database.followUpRules.filter((rule) => rule.isActive).length,
        pending: database.followUpTasks.filter((task) => task.status === 'PENDING').length,
        completed: database.followUpTasks.filter((task) => task.status === 'COMPLETED').length,
        overdue: database.followUpTasks.filter((task) => task.status === 'PENDING' && new Date(task.dueAt) < new Date()).length
      } }
    }
    if (path === '/follow-ups/evaluate' && method === 'POST') return { data: { created: 2, skipped: 3, evaluatedRules: database.followUpRules.length } }
    if (second === 'tasks' && third && fourth === 'status' && method === 'PATCH') {
      const task = database.followUpTasks.find((row) => row.id === third)
      if (task) { task.status = body?.status || task.status; persist() }
      return { data: task || {} }
    }
  }

  // -- Settings, hierarchy, quotas, branding --------------------------------
  if (root === 'settings') {
    if (path === '/settings') {
      if (method === 'PATCH') { Object.assign(database.settings, body); persist(); return { data: database.settings } }
      return { data: database.settings }
    }
    if (path === '/settings/exchange-rates') return { data: database.fx }
    if (path === '/settings/exchange-rates/currencies' && method === 'POST') {
      const currency = { id: nextId('demo-fx', database.fx.currencies), ...body, toBaseRate: null, fromBaseRate: null, isEnabled: true, isBaseCurrency: false }
      database.fx.currencies.push(currency)
      persist()
      return { data: currency }
    }
    if (path === '/settings/exchange-rates' && method === 'POST') {
      const rate = { id: nextId('demo-rate', database.fx.rates), ...body, effectiveAt: body?.effectiveAt || new Date().toISOString() }
      database.fx.rates.push(rate)
      persist()
      return { data: rate }
    }
    if (path === '/settings/permissions') return { data: database.permissions }
    if (path === '/settings/whatsapp-templates') {
      if (method === 'PATCH') { database.whatsappTemplates = { templates: body?.templates || database.whatsappTemplates.templates }; persist() }
      return { data: database.whatsappTemplates }
    }
  }
  if (root === 'hierarchy') {
    const collection = second === 'branches' ? database.branches : database.teams
    if (method === 'POST') {
      const row = { id: nextId(`demo-${second === 'branches' ? 'branch' : 'team'}`, collection), organizationId: DEMO_ORG_ID, ...body }
      collection.unshift(row)
      persist()
      return { data: row }
    }
    if (second === 'teams' || second === 'branches') return resourceList(collection, params)
  }
  if (root === 'quotas') {
    if (method === 'PATCH') {
      if (body?.plan) database.quotas.plan = String(body.plan)
      if (body?.overrides) {
        for (const [key, value] of Object.entries(body.overrides)) {
          if (value !== null && value !== undefined) database.quotas.limits[key] = Number(value)
        }
      }
      persist()
    }
    const limits = { ...database.quotas.limits }
    const planCaps: Record<string, Record<string, number | null>> = {
      FREE: { users: 5, properties: 25, deals: 50, storageMb: 100 },
      STARTER: { users: 15, properties: 60, deals: 150, storageMb: 500 },
      GROWTH: { users: 30, properties: 100, deals: 250, storageMb: 2048 },
      ENTERPRISE: { users: null, properties: null, deals: null, storageMb: null }
    }
    const effective = { ...(planCaps[database.quotas.plan] || planCaps.GROWTH), ...limits }
    const entries = Object.entries(database.quotas.usage).map(([key, used]) => {
      const limit = effective[key] ?? null
      const percent = limit ? Math.round(Number(used) / Number(limit) * 100) : null
      return { key, label: key, labelAr: key, used: Number(used), limit, remaining: limit ? Math.max(0, Number(limit) - Number(used)) : null, percent, status: limit === null ? 'UNLIMITED' : Number(used) >= limit ? 'LIMIT_REACHED' : Number(percent) >= 80 ? 'WARNING' : 'OK' }
    })
    return { data: { ...database.quotas, limits: effective, entries } }
  }
  if (root === 'branding') {
    if (method === 'PATCH') { Object.assign(database.branding, body); persist() }
    return { data: database.branding }
  }

  // -- Reports, activity, search --------------------------------------------
  if (root === 'reports') {
    if (path === '/reports/summary') return reportSummary(database)
    if (path === '/reports/team') return reportTeam(database)
    if (path === '/reports/uncontacted-leads') {
      const rows = (reportSummary(database).data as DemoRow).sla.uncontactedLeads as DemoRow[]
      return {
        contentType: 'text/csv;charset=utf-8',
        data: csvText([
          ['id', 'firstName', 'lastName', 'email', 'phone', 'createdAt'],
          ...rows.map((row) => [row.id, row.firstName, row.lastName || '', row.email || '', row.phone || '', row.createdAt || ''])
        ])
      }
    }
    if (path === '/reports/export') {
      return { contentType: 'text/csv;charset=utf-8', data: csvText([['section', 'label', 'value'], ['demo', 'Generated by', 'EstateOS Live Demo']]) }
    }
  }
  if (root === 'activity') {
    if (path === '/activity/export') {
      let exportRows = database.activity.filter((row) => matches(row, params))
      if (params.entityType && params.entityId) {
        exportRows = exportRows.filter((row) => row.entityType === params.entityType && row.entityId === params.entityId)
      }
      return {
        contentType: 'text/csv;charset=utf-8',
        data: csvText([
          ['id', 'action', 'entityType', 'entityId', 'actor', 'timestamp'],
          ...exportRows.map((row) => [
            row.id,
            row.action,
            row.entityType,
            row.entityId,
            String(row.actor?.email || ''),
            String(row.timestamp || '')
          ])
        ])
      }
    }
    let rows = database.activity.filter((row) => matches(row, params))
    if (params.entityType && params.entityId) {
      rows = rows.filter((row) => row.entityType === params.entityType && row.entityId === params.entityId)
    }
    const result = paginate(rows, params)
    return {
      data: result.rows,
      extras: { pagination: result.pagination, nextCursor: null }
    }
  }
  if (root === 'search') return globalSearch(database, params)

  // -- Public read-only portals ---------------------------------------------
  if (root === 'public') {
    if (second === 'properties') {
      const property = database.properties.find((row) => row.id === id || row.shareLink?.token === id || row.publicShareToken === id) || database.properties[0]
      return { data: {
        referenceNumber: property.referenceNumber,
        title: property.title,
        description: property.description,
        type: property.type, status: property.status, classification: property.classification,
        address: property.address, city: property.city, state: property.state, country: property.country,
        postalCode: property.postalCode, latitude: property.latitude, longitude: property.longitude,
        area: property.area, areaUnit: property.areaUnit, bedrooms: property.bedrooms,
        bathrooms: property.bathrooms, floors: property.floors, yearBuilt: property.yearBuilt,
        condition: property.condition, price: property.price, currency: property.currency,
        negotiable: property.negotiable, availableFrom: property.availableFrom,
        shareExpiresAt: property.shareLink?.expiresAt || null,
        images: (property.images || []).map((image: DemoRow) => ({ ...image, contentUrl: image.contentUrl || image.url })),
        attachments: property.attachments || []
      } }
    }
    if (second === 'owner-portal') {
      const owner = database.owners.find((row) => row.id === id) || database.owners[0]
      const properties = database.properties.filter((row) => row.ownerId === owner.id)
      const deals = database.deals.filter((deal) => properties.some((property) => property.id === deal.propertyId))
      return { data: {
        owner: { displayName: owner.displayName || owner.companyName || 'Demo owner', city: owner.city, country: owner.country, organizationName: 'EstateOS Demo Realty' },
        properties: properties.map((property) => ({
          referenceNumber: property.referenceNumber, title: property.title, description: property.description,
          type: property.type, status: property.status, classification: property.classification,
          address: property.address, city: property.city, state: property.state, country: property.country,
          postalCode: property.postalCode, price: property.price, currency: property.currency,
          bedrooms: property.bedrooms, bathrooms: property.bathrooms, floors: property.floors,
          area: property.area, areaUnit: property.areaUnit, yearBuilt: property.yearBuilt,
          condition: property.condition, negotiable: property.negotiable, availableFrom: property.availableFrom
        })),
        summary: { properties: properties.length, deals: deals.length, dealStatuses: deals.reduce((acc: Record<string, number>, deal) => { acc[deal.status] = (acc[deal.status] || 0) + 1; return acc }, {}) }
      } }
    }
    if (second === 'client-portal') {
      const lead = database.leads.find((row) => row.id === id || row.portalToken === id) || database.leads[0]
      const property = database.properties.find((row) => row.id === lead.propertyId) || database.properties[0]
      const deals = database.deals.filter((deal) => deal.leadId === lead.id || deal.propertyId === property.id)
      const portalDeals = deals.map((deal) => {
        const payments = database.payments.filter((row) => row.dealId === deal.id)
        const paid = payments.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + Number(row.amount), 0)
        return {
          referenceNumber: deal.referenceNumber, type: deal.type, status: deal.status,
          amount: String(deal.amount), currency: deal.currency, dueAt: deal.dueAt,
          closedAt: deal.closedAt, leaseStartAt: deal.leaseStartAt, leaseEndAt: deal.leaseEndAt,
          startedAt: deal.startedAt,
          property: { title: property.title, referenceNumber: property.referenceNumber, city: property.city },
          payments: payments.map((row) => ({ amount: String(row.amount), currency: row.currency, status: row.status, reference: row.reference, dueAt: row.dueAt, paidAt: row.paidAt })),
          summary: { payments: payments.length, due: String(deal.amount), paid: String(paid), outstanding: String(Math.max(0, Number(deal.amount) - paid)) }
        }
      })
      return { data: {
        kind: 'LEAD',
        client: { displayName: `${lead.firstName} ${lead.lastName || ''}`.trim(), organizationName: 'EstateOS Demo Realty' },
        property: {
          referenceNumber: property.referenceNumber, title: property.title, description: property.description,
          type: property.type, status: property.status, classification: property.classification,
          address: property.address, city: property.city, state: property.state, country: property.country,
          postalCode: property.postalCode, price: property.price, currency: property.currency,
          bedrooms: property.bedrooms, bathrooms: property.bathrooms, floors: property.floors,
          area: property.area, areaUnit: property.areaUnit, yearBuilt: property.yearBuilt,
          condition: property.condition, negotiable: property.negotiable, availableFrom: property.availableFrom
        },
        clientInterest: { displayName: 'Demo Client' },
        deal: portalDeals[0] || null,
        deals: portalDeals,
        lead: { status: lead.status, preferredType: lead.preferredType, preferredCity: lead.preferredCity, preferredBedrooms: lead.preferredBedrooms, budgetMin: lead.budgetMin, budgetMax: lead.budgetMax }
      } }
    }
  }

  if (root === 'documents' && second && id && (third === 'preview' || third === 'download')) {
    return { contentType: 'text/plain;charset=utf-8', data: 'EstateOS Live Demo — sample document content.' }
  }

  // -- Owner portal, statements and payouts ---------------------------------
  if (root === 'owners' && second) {
    const ownerPortal = handlePortalRoute(method, second, third, id, database.owners, 'owner-portal/')
    if (ownerPortal) return ownerPortal
    const owner = database.owners.find((row) => row.id === id)
    if (!owner) return { status: 404, data: { error: { message: 'Owner not found in demo data.' } } }
    const ownedProperties = database.properties.filter((property) => property.ownerId === owner.id)
    const ownerDeals = database.deals.filter((deal) => ownedProperties.some((property) => property.id === deal.propertyId))
    if (third === 'statement') {
      const byStatus: Record<string, number> = {}
      for (const property of ownedProperties) byStatus[property.status] = (byStatus[property.status] || 0) + 1
      const dealStatuses: Record<string, number> = {}
      const dealTypes: Record<string, number> = {}
      for (const deal of ownerDeals) {
        dealStatuses[deal.status] = (dealStatuses[deal.status] || 0) + 1
        dealTypes[deal.type] = (dealTypes[deal.type] || 0) + 1
      }
      const currencies = Array.from(new Set(ownedProperties.map((property) => property.currency)))
      return { data: {
        owner: { id: owner.id, displayName: owner.displayName, email: owner.email, city: owner.city, country: owner.country },
        generatedAt: new Date().toISOString(),
        properties: {
          count: ownedProperties.length,
          activeCount: ownedProperties.filter((property) => property.status === 'AVAILABLE').length,
          byStatus,
          list: ownedProperties.map((property) => ({ id: property.id, referenceNumber: property.referenceNumber, title: property.title, status: property.status, price: String(property.price), currency: property.currency }))
        },
        deals: { count: ownerDeals.length, byStatus: dealStatuses, byType: dealTypes },
        financialsRestricted: false,
        financials: { currencies: currencies.map((currency) => ({
          currency,
          properties: ownedProperties.filter((property) => property.currency === currency).length,
          deals: ownerDeals.filter((deal) => deal.currency === currency).length,
          payments: database.payments.filter((payment) => payment.currency === currency).length,
          expenses: database.expenses.filter((expense) => expense.currency === currency).length,
          net: String(ownerDeals.filter((deal) => deal.currency === currency).reduce((sum, deal) => sum + Number(deal.amount), 0))
        })) }
      } }
    }
    if (third === 'payouts') {
      if (method === 'POST') {
        const payout = {
          id: nextId('demo-payout', database.ownerPayouts),
          organizationId: DEMO_ORG_ID,
          ownerId: owner.id,
          amount: Number(body?.amount || 0),
          currency: String(body?.currency || 'USD'),
          status: 'PENDING',
          reference: String(body?.reference || `PO-${800 + database.ownerPayouts.length}`),
          notes: String(body?.notes || ''),
          periodStart: body?.periodStart || null,
          periodEnd: body?.periodEnd || null,
          settledAt: null,
          createdById: database.currentUserId,
          createdAt: new Date().toISOString()
        }
        database.ownerPayouts.unshift(payout)
        persist()
        return { data: payout, extras: { summary: { count: database.ownerPayouts.filter((row) => row.ownerId === owner.id).length } } }
      }
      if (fourth && method === 'PATCH') {
        const payout = database.ownerPayouts.find((row) => row.id === fourth)
        if (payout) {
          payout.status = String(body?.status || payout.status)
          payout.settledAt = payout.status === 'SETTLED' ? new Date().toISOString() : null
          persist()
        }
        return { data: payout || {}, extras: { summary: { count: database.ownerPayouts.filter((row) => row.ownerId === owner.id).length } } }
      }
      const rows = database.ownerPayouts.filter((row) => row.ownerId === owner.id)
      return { data: rows, extras: { summary: { count: rows.length, total: rows.reduce((sum, row) => sum + Number(row.amount), 0) } } }
    }
  }

  // -- Webhooks -------------------------------------------------------------
  if (root === 'webhooks') {
    if (path === '/webhooks/endpoints') {
      if (method === 'POST') {
        const endpoint = { id: nextId('demo-webhook', database.webhookEndpoints), organizationId: DEMO_ORG_ID, url: String(body?.url || ''), events: body?.events || [], isActive: body?.isActive !== false, createdById: database.currentUserId, updatedById: database.currentUserId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null }
        database.webhookEndpoints.unshift(endpoint)
        persist()
        return { data: { data: endpoint, secret: 'demo_webhook_secret_estateos' } }
      }
      return { data: { data: database.webhookEndpoints } }
    }
    if (second === 'endpoints' && third && method === 'PATCH') {
      const endpoint = database.webhookEndpoints.find((row) => row.id === third)
      if (endpoint) { endpoint.isActive = !endpoint.isActive; persist() }
      return { data: { data: endpoint || {} } }
    }
    if (path === '/webhooks/deliveries') {
      const result = paginate(database.webhookDeliveries, params)
      return { data: { data: result.rows, pagination: result.pagination } }
    }
    if (second === 'deliveries' && third && fourth === 'retry' && method === 'POST') {
      const delivery = database.webhookDeliveries.find((row) => row.id === third)
      if (delivery) { delivery.status = 'RETRYING'; delivery.attempt += 1; persist() }
      return { data: delivery || {} }
    }
  }

  if (path === '/admin/export-snapshot') {
    return { contentType: 'application/json', data: JSON.stringify({ generatedAt: new Date().toISOString(), demo: true, database }, null, 2) }
  }

  // -- Generic collections --------------------------------------------------
  const collection = collectionFor(root, second)
  if (collection) {
    const rows = database[collection.key] as DemoRow[]
    if (method === 'POST') {
      const row = { id: nextId(collection.prefix, rows), organizationId: DEMO_ORG_ID, ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      rows.unshift(row)
      persist()
      return { data: row }
    }
    if (second && id) {
      const row = rows.find((item) => item.id === id)
      if (method === 'PATCH') { if (row) touch(row, body); persist(); return { data: row || {} } }
      if (method === 'DELETE') {
        const index = rows.findIndex((item) => item.id === id)
        if (index >= 0) rows.splice(index, 1)
        persist()
        return { data: { success: true } }
      }
      if (row) return { data: root === 'users' ? publicUser(row) : row }
    }
    if (root === 'users' && !second) {
      return resourceList(rows.map(publicUser), params, {
        activeLeads: (row) => database.leads.filter((lead) => lead.assignedToId === row.id && lead.isActive).length,
        activeDeals: (row) => database.deals.filter((deal) => deal.userId === row.id && ['ACTIVE', 'PENDING'].includes(deal.status)).length
      })
    }
    const extras: Record<string, (row: DemoRow) => unknown> = {}
    if (root === 'owners') extras._count = (row) => ({
      properties: database.properties.filter((property) => property.ownerId === row.id).length,
      deals: database.deals.filter((deal) => database.properties.some((property) => property.ownerId === row.id && property.id === deal.propertyId)).length
    })
    if (root === 'maintenance') extras.property = (row) => row.property || null
    if (root === 'documents') {
      extras.uploadedBy = (row) => row.uploadedBy || null
      extras.property = (row) => row.property || null
    }
    return resourceList(rows, params, extras)
  }

  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return { data: { success: true } }
  return { data: [] }
}

// ---------------------------------------------------------------------------
// Public helpers consumed by client.ts and the few raw-fetch call sites
// ---------------------------------------------------------------------------

function axiosResponse(config: InternalAxiosRequestConfig, result: DemoResult) {
  const status = result.status || 200
  if (status >= 400) {
    const error = new AxiosError(
      (result.data?.error as { message?: string })?.message || 'Demo request failed.',
      'ERR_BAD_RESPONSE',
      config,
      undefined,
      {
        data: { success: false, ...result.data },
        status,
        statusText: 'Demo error',
        headers: { 'content-type': 'application/json' } as any,
        config
      }
    )
    return Promise.reject(error)
  }
  let data: any = result.data
  if (config.responseType === 'blob' || config.responseType === 'arraybuffer') {
    const mime = result.contentType || 'application/json'
    data = new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: mime })
  } else if (result.contentType?.startsWith('text/')) {
    // Raw CSV responses are returned verbatim by demoFetch; axios callers get
    // the envelope shape they expect.
    data = { success: true, data }
  } else {
    data = { success: true, data, ...(result.extras || {}), ...(result.message ? { message: result.message } : {}) }
  }
  return Promise.resolve({
    data,
    status,
    statusText: 'OK',
    headers: { 'content-type': result.contentType || 'application/json' } as any,
    config
  })
}

const networkClient = axios.create()

function callRealBackend(config: InternalAxiosRequestConfig) {
  // Reset the adapter so the delegated request cannot recurse into demo mode.
  return networkClient.request({ ...config, adapter: networkClient.defaults.adapter } as InternalAxiosRequestConfig)
}

export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  await ensureDemoDecision()
  if (!demoMode.value) return callRealBackend(config)
  const url = String(config.url || '')
  // Never mock third-party URLs (avatars, maps, CDNs).
  if (/^https?:\/\//i.test(url)) return callRealBackend(config)
  const result = handleDemoRequest(String(config.method || 'get').toUpperCase(), url, paramsFromUrl(url, config.params), bodyFrom(config))
  return axiosResponse(config, result)
}

/** Drop-in replacement for the handful of views that use raw fetch for exports. */
export async function demoFetch(input: string, init?: RequestInit): Promise<Response> {
  await ensureDemoDecision()
  if (!demoMode.value) return fetch(input, init)
  const url = String(input)
  const method = String(init?.method || 'GET').toUpperCase()
  let body: any = init?.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { /* keep as text */ }
  }
  const authHeader = new Headers(init?.headers).get('Authorization')
  if (!authHeader) {
    // Demo downloads do not require a real token.
  }
  const result = handleDemoRequest(method, url, paramsFromUrl(url), body)
  const contentType = result.contentType || 'application/json'
  const payload = contentType.startsWith('text/') || contentType.startsWith('application/json') && typeof result.data === 'string'
    ? String(result.data)
    : JSON.stringify({ success: true, data: result.data, ...(result.extras || {}) })
  return new Response(payload, { status: result.status || 200, statusText: 'OK', headers: { 'Content-Type': contentType } })
}

export { DEMO_PASSWORD, DEMO_LOGIN_ACCOUNTS } from './demoData'

export function demoAccountLabel(): string {
  const user = currentUser(db())
  return `${user.email} / ${DEMO_PASSWORD}`
}
