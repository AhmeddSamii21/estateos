export type Role = 'ADMIN' | 'MANAGER' | 'AGENT' | 'ACCOUNTANT'
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
  isActive: boolean
  createdAt: string
  updatedAt: string
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
  notes?: string | null
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
  paidAt?: string | null
  createdAt: string
}

export interface PaymentSummary {
  dealAmount: MoneyValue
  dealBaseAmount?: MoneyValue
  currency: string
  received: MoneyValue
  outstanding: MoneyValue
  payments: number
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

export interface MaintenanceRequest {
  id: string
  organizationId: string
  propertyId: string
  title: string
  description?: string | null
  priority: string
  status: string
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
    expenses: Array<{ currency: string; amount: MoneyValue; baseAmount: MoneyValue }>
    commissions: Array<{ currency: string; amount: MoneyValue; baseAmount: MoneyValue }>
    paymentTotalBase: MoneyValue
    expenseTotalBase: MoneyValue
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
