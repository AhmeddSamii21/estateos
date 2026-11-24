export type Role = 'ADMIN' | 'MANAGER' | 'AGENT' | 'ACCOUNTANT' | 'TEAM_LEAD'
export type MoneyValue = string | number

export interface AuthUser {
  id: string
  email: string
  role: Role
  organizationId: string
  accountStatus?: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED'
  statusReason?: string | null
  firstName?: string | null
  profileImage?: string | null
  isActive?: boolean
  lastLoginAt?: string | null
  loginCount?: number
  createdAt?: string
}

export interface Paginated<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface Property {
  id: string
  referenceNumber: string
  title: string
  description?: string | null
  type: string
  status: string
  classification: string
  address?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postalCode?: string | null
  latitude?: MoneyValue | null
  longitude?: MoneyValue | null
  area?: MoneyValue | null
  areaUnit: string
  bedrooms: number
  bathrooms: number
  floors?: number | null
  yearBuilt?: number | null
  condition: string
  price: MoneyValue
  currency: string
  negotiable: boolean
  featured: boolean
  reservedUntil?: string | null
  availableFrom?: string | null
  occupancyStatus?: string | null
  operationalNotes?: string | null
  organizationId: string
  ownerId?: string | null
  assignedAgentId?: string | null
  createdAt: string
  updatedAt: string
}

export interface PropertyImage {
  id: string
  propertyId?: string
  url: string
  storageKey?: string | null
  originalName?: string | null
  mimeType?: string | null
  size?: number | null
  caption?: string | null
  isPrimary: boolean
  sortOrder?: number
  createdAt?: string
}

/** Package 14: floorplan/brochure attachment shown on property pages. */
export interface PropertyAttachment {
  id: string
  name: string
  url: string
  kind: 'FLOORPLAN' | 'BROCHURE'
  mimeType: string | null
  originalName: string | null
  size: number | null
  sortOrder: number
  contentUrl: string | null
}

export interface PropertyActivity {
  id: string
  propertyId: string
  userId?: string | null
  action: string
  details?: string | null
  createdAt: string
  user?: Pick<AppUser, 'id' | 'email' | 'firstName'> | null
}

export interface PropertyFilters {
  keyword?: string
  search?: string
  status?: string
  type?: string
  city?: string
  country?: string
  currency?: string
  minPrice?: string | number | null
  maxPrice?: string | number | null
  bedrooms?: string | number | null
  bathrooms?: string | number | null
  minArea?: string | number | null
  maxArea?: string | number | null
  assignedAgentId?: string
  availability?: 'available' | 'unavailable' | ''
  featured?: boolean | '' | null
  minLatitude?: string | number | null
  maxLatitude?: string | number | null
  minLongitude?: string | number | null
  maxLongitude?: string | number | null
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'area_desc' | ''
  page?: number
  limit?: number
}

export interface PropertyDetail extends Property {
  owner?: Record<string, unknown> | null
  assignedAgent?: Pick<AppUser, 'id' | 'email' | 'firstName' | 'role'> | null
  images?: PropertyImage[]
  attachments?: PropertyAttachment[]
  linkedDocuments?: DocumentRecord[]
  activities?: PropertyActivity[]
  leads?: Lead[]
  appointments?: Appointment[]
  deals?: Deal[]
  expenses?: Expense[]
  maintenanceRequests?: MaintenanceRequest[]
  _count?: { leads?: number; deals?: number; maintenanceRequests?: number }
}

export interface Lead {
  id: string
  firstName: string
  lastName?: string | null
  email?: string | null
  phone?: string | null
  status: string
  source?: string | null
  priorityScore?: number
  priorityTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  notes?: string | null
  budgetMin?: MoneyValue | null
  budgetMax?: MoneyValue | null
  preferredType?: string | null
  preferredCity?: string | null
  preferredBedrooms?: number | null
  preferredAreaMin?: MoneyValue | null
  preferredAreaMax?: MoneyValue | null
  assignedToId?: string | null
  propertyId?: string | null
  nextFollowUpAt?: string | null
  lastContactedAt?: string | null
  followUpNotes?: LeadNote[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface LeadNote {
  id: string
  leadId: string
  authorId?: string | null
  body: string
  nextFollowUpAt?: string | null
  createdAt: string
  author?: { id: string; firstName?: string | null; email?: string } | null
}

export interface LeadMatch {
  score: number
  reasons: string[]
  property: Pick<Property, 'id' | 'referenceNumber' | 'title' | 'type' | 'status' | 'city' | 'state' | 'country' | 'address' | 'bedrooms' | 'bathrooms' | 'area' | 'areaUnit' | 'price' | 'currency' | 'assignedAgentId'>
}

export interface LeadMatchesResponse {
  leadId: string
  criteria: {
    budgetMin?: MoneyValue | null
    budgetMax?: MoneyValue | null
    preferredType?: string | null
    preferredCity?: string | null
    preferredBedrooms?: number | null
    preferredAreaMin?: MoneyValue | null
    preferredAreaMax?: MoneyValue | null
  }
  matches: LeadMatch[]
}

export interface Appointment {
  id: string
  title?: string | null
  type: string
  status: string
  startsAt: string
  endsAt?: string | null
  notes?: string | null
  userId: string
  propertyId?: string | null
  leadId?: string | null
  createdAt: string
  updatedAt: string
}

export interface Deal {
  id: string
  referenceNumber?: string | null
  type: string
  status: string
  propertyId: string
  leadId?: string | null
  userId: string
  organizationId: string
  amount: MoneyValue
  baseAmount?: MoneyValue | null
  exchangeRate?: MoneyValue | null
  currency: string
  startedAt?: string | null
  dueAt?: string | null
  closedAt?: string | null
  leaseStartAt?: string | null
  leaseEndAt?: string | null
  renewalNoticeDays?: number | null
  notes?: string | null
  checklistOverrideReason?: string | null
  checklistOverriddenAt?: string | null
  closingChecklist?: DealChecklistItem[]
  createdAt: string
  updatedAt: string
  property?: Pick<Property, 'id' | 'title' | 'referenceNumber' | 'city' | 'address'> | null
  user?: Pick<AppUser, 'id' | 'email' | 'firstName' | 'role'> | null
  lead?: Lead | null
  payments?: Payment[]
  commissions?: Commission[]
  documents?: DocumentRecord[]
  expenses?: Expense[]
  auditTrail?: AuditLog[]
  _count?: { payments?: number; commissions?: number }
}

export interface DealChecklistItem {
  id: string
  itemKey: string
  label: string
  isCompleted: boolean
  completedAt?: string | null
  completedById?: string | null
}

export interface DealChecklistProgress {
  completed: number
  total: number
  isComplete: boolean
  items: DealChecklistItem[]
}

export type PaymentAgingBucket = 'CURRENT' | '1_30_DAYS' | '31_60_DAYS' | '60_PLUS_DAYS' | 'PAID'

export interface PaymentAgingResult {
  bucket: PaymentAgingBucket
  daysPastDue: number
}

export interface PaymentAgingSummaryRow {
  count: number
  amount: MoneyValue
  baseAmount: MoneyValue
}

export type PaymentAgingSummary = Record<PaymentAgingBucket, PaymentAgingSummaryRow>

export interface Payment {
  id: string
  dealId: string
  amount: MoneyValue
  baseAmount?: MoneyValue | null
  exchangeRate?: MoneyValue | null
  currency: string
  status: string
  method?: string | null
  reference?: string | null
  idempotencyKey?: string | null
  notes?: string | null
  dueAt?: string | null
  paidAt?: string | null
  createdAt: string
  aging?: PaymentAgingResult
}

export interface PaymentSummary {
  dealAmount: MoneyValue
  dealBaseAmount?: MoneyValue
  currency: string
  received: MoneyValue
  outstanding: MoneyValue
  payments: number
  aging?: PaymentAgingSummary
}

export interface Expense {
  id: string
  propertyId?: string | null
  dealId?: string | null
  responsibleId?: string | null
  category: string
  description?: string | null
  amount: MoneyValue
  baseAmount?: MoneyValue | null
  exchangeRate?: MoneyValue | null
  currency: string
  status: string
  spentAt: string
  paidAt?: string | null
  createdAt: string
}

export interface Commission {
  id: string
  dealId: string
  userId?: string | null
  amount: MoneyValue
  baseAmount?: MoneyValue | null
  currency: string
  rate?: MoneyValue | null
  status: string
  notes?: string | null
  approvedAt?: string | null
  paidAt?: string | null
  paymentReference?: string | null
  createdAt: string
}

export interface DocumentRecord {
  id: string
  organizationId: string
  name: string
  originalName: string
  storageKey: string
  mimeType: string
  size: number
  category: string
  description?: string | null
  notes?: string | null
  status: string
  uploadedById?: string | null
  propertyId?: string | null
  ownerId?: string | null
  leadId?: string | null
  dealId?: string | null
  paymentId?: string | null
  expenseId?: string | null
  createdAt: string
  updatedAt: string
  uploadedBy?: Pick<AppUser, 'id' | 'email' | 'firstName'> | null
  property?: Pick<Property, 'id' | 'title'> | null
  deal?: Pick<Deal, 'id' | 'referenceNumber'> | null
}

export type MaintenanceRecurrenceInterval = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL'

export interface MaintenanceRequest {
  id: string
  organizationId: string
  propertyId: string
  title: string
  description?: string | null
  priority: string
  status: string
  recurrenceInterval?: MaintenanceRecurrenceInterval
  nextDueAt?: string | null
  recurrenceSourceId?: string | null
  assignedToId?: string | null
  createdById?: string | null
  cost?: MoneyValue | null
  currency: string
  dueAt?: string | null
  completedAt?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  property?: Pick<Property, 'id' | 'title' | 'referenceNumber'> | null
  assignedTo?: Pick<AppUser, 'id' | 'email' | 'firstName'> | null
  createdBy?: Pick<AppUser, 'id' | 'email' | 'firstName'> | null
}

export type OwnerPayoutStatus = 'PENDING' | 'SETTLED' | 'CANCELLED'

export interface OwnerPayout {
  id: string
  organizationId: string
  ownerId: string
  amount: MoneyValue
  currency: string
  status: OwnerPayoutStatus
  reference?: string | null
  notes?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  settledAt?: string | null
  settledById?: string | null
  createdById?: string | null
  createdAt: string
  updatedAt: string
}

export interface OwnerPayoutSummary {
  pending: MoneyValue
  settled: MoneyValue
  cancelled: MoneyValue
  count: number
}

export interface PermissionMatrix {
  roles: Role[]
  permissions: string[]
  matrix: Record<string, Record<string, boolean>>
}

export interface AuditLog {
  id: string
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  details?: string | null
  createdAt: string
}

export interface AppUser {
  id: string
  email: string
  role: Role
  organizationId: string
  firstName?: string | null
  isActive: boolean
  lastLoginAt?: string | null
  loginCount: number
  createdAt: string
}

export interface TenantSettings {
  id: string
  organizationId: string
  defaultLanguage: string
  defaultCurrency: string
  data: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ManagedCurrency {
  id: string
  code: string
  name: string
  symbol: string
  decimals: number
  isEnabled: boolean
  isBaseCurrency: boolean
  toBaseRate: string | null
  fromBaseRate: string | null
  toBaseEffectiveAt: string | null
  fromBaseEffectiveAt: string | null
}

export interface ManagedExchangeRate {
  id: string
  fromCurrency: { code: string }
  toCurrency: { code: string }
  rate: MoneyValue
  effectiveAt: string
  note?: string | null
}

export interface ExchangeRateOverview {
  baseCurrency: string
  currencies: ManagedCurrency[]
  rates: ManagedExchangeRate[]
}

export interface PropertyShareLink {
  enabled: boolean
  token: string | null
  url: string | null
  expiresAt: string | null
  createdAt: string | null
}

export interface PublicProperty {
  referenceNumber: string
  title: string
  description: string | null
  type: string
  status: string
  classification: string
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
  latitude: MoneyValue | null
  longitude: MoneyValue | null
  area: MoneyValue | null
  areaUnit: string
  bedrooms: number
  bathrooms: number
  floors: number | null
  yearBuilt: number | null
  condition: string
  price: MoneyValue
  currency: string
  negotiable: boolean
  availableFrom: string | null
  shareExpiresAt: string | null
  images: Array<{
    id: string
    originalName: string | null
    mimeType: string | null
    size: number | null
    caption: string | null
    isPrimary: boolean
    sortOrder: number
    contentUrl: string
  }>
  attachments?: PropertyAttachment[]
}

export interface GroupCount<T extends string = string> {
  [key: string]: unknown
  status?: T
  type?: T
  city?: string | null
  currency?: string | null
  _count: { _all: number }
  _sum?: { amount?: MoneyValue | null; baseAmount?: MoneyValue | null; cost?: MoneyValue | null }
}

export interface ReportSummary {
  properties: {
    total: number
    available: number
    unavailable: number
    byStatus: GroupCount[]
    byType: GroupCount[]
    byCity: GroupCount[]
  }
  deals: { total: number; active: number; completed: number }
  finance: {
    payments: Array<{ currency: string; amount: MoneyValue; baseAmount: MoneyValue }>
    paymentAging?: PaymentAgingSummary
    expenses: Array<{ currency: string; amount: MoneyValue; baseAmount: MoneyValue }>
    commissions: Array<{ currency: string; amount: MoneyValue; baseAmount: MoneyValue }>
    paymentTotalBase: MoneyValue
    expenseTotalBase: MoneyValue
    fx?: {
      baseCurrency: string
      convertedPaymentTotal: string | null
      missingCurrencies: string[]
      hasRates: boolean
    }
  }
  maintenance: {
    byStatus: GroupCount[]
    totalCost: MoneyValue
  }
}

export interface ApiErrorShape {
  message: string
  code?: string
  fields?: Record<string, string>
}

export interface AppointmentConflictInfo {
  id: string
  title: string | null
  startsAt: string
  endsAt: string | null
  status: string
  userId: string
  propertyId: string | null
  reasons: Array<'user' | 'property'>
}

export interface ApiWarning {
  code: string
  message: string
  conflicts?: AppointmentConflictInfo[]
}

export interface Owner {
  id: string
  organizationId?: string | null
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  displayName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  notes?: string | null
  isActive: boolean
  createdAt?: string
  updatedAt?: string
  properties?: Array<Pick<Property, 'id' | 'title' | 'referenceNumber' | 'status' | 'city' | 'price' | 'currency'>>
  _count?: { properties?: number }
}

export interface OwnerStatement {
  owner: { id: string; displayName: string | null }
  generatedAt: string
  properties: {
    count: number
    activeCount: number
    byStatus: Record<string, number>
    list: Array<{
      id: string
      title: string
      referenceNumber: string
      status: string
      city: string | null
      price?: MoneyValue
      currency?: string | null
    }>
  }
  deals: { count: number; byStatus: Record<string, number>; byType: Record<string, number> }
  financialsRestricted: boolean
  financials?: {
    currencies: Array<{
      currency: string
      properties: { count: number; listedValue: string }
      deals: { count: number; amount: string }
      payments: { count: number; collected: string }
      expenses: { count: number; paid: string }
      net: string
    }>
  }
}

export interface PriceHistoryEntry {
  id: string
  timestamp: string
  oldPrice: string
  oldCurrency: string
  newPrice: string
  newCurrency: string
}

export interface ActivityEntityInfo {
  id: string
  label: string
  meta: Record<string, string | number | boolean | null>
  href: string | null
}

export interface ActivityChange {
  field: string
  before?: unknown
  after?: unknown
  changed?: boolean
}

export interface ActivityEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  timestamp: string
  actor: { id: string; email: string; firstName: string | null; role: Role } | null
  entity: ActivityEntityInfo
  metadata: Record<string, unknown>
  changes: ActivityChange[]
}

export interface AppNotification {
  id: string
  organizationId?: string | null
  userId: string
  type: string
  title: string
  message: string
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  metadata?: string | null
  isRead: boolean
  readAt?: string | null
  createdAt: string
}

/** Package 22: outbound webhook configuration and delivery log. */
export const WEBHOOK_EVENT_CODES = [
  'property.created',
  'lead.created',
  'deal.stage_changed',
  'payment.recorded'
] as const

export type WebhookEventCode = (typeof WEBHOOK_EVENT_CODES)[number]
export type WebhookDeliveryStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING'

export interface WebhookEndpoint {
  id: string
  organizationId: string
  url: string
  events: WebhookEventCode[]
  isActive: boolean
  createdById: string
  updatedById: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface WebhookDelivery {
  id: string
  organizationId: string
  endpointId: string
  event: WebhookEventCode
  eventKey: string
  status: WebhookDeliveryStatus
  attempt: number
  requestUrl: string
  payload: Record<string, unknown>
  responseStatus: number | null
  responseBody: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  nextRetryAt: string | null
}

export interface WebhookEndpointList {
  data: WebhookEndpoint[]
}

export type WebhookDeliveryList = Paginated<WebhookDelivery>

export interface WebhookEndpointCreated {
  data: WebhookEndpoint
  /** Raw signing secret, returned once and never available again. */
  secret: string
}
