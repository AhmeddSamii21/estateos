export interface FieldConfig {
  key: string
  label: string
  labelAr?: string
  type: 'text' | 'number' | 'email' | 'password' | 'date' | 'datetime-local' | 'select' | 'textarea' | 'checkbox'
  options?: string[]
  optionsAr?: string[]
  required?: boolean
  createOnly?: boolean
  default?: string | number | boolean
}

export interface ResourceConfig {
  endpoint: string
  title: string
  titleAr: string
  fields: FieldConfig[]
  columns: { key: string; label: string; labelAr?: string; money?: boolean; date?: boolean }[]
  deletable?: boolean
  deletableRoles?: string[]
}

const leadStatus = ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATION', 'WON', 'LOST']
const propertyTypes = ['HOUSE', 'APARTMENT', 'CONDO', 'TOWNHOUSE', 'VILLA', 'LAND', 'COMMERCIAL']
const appointmentTypes = ['VIEWING', 'MEETING', 'CALL']
export const appointmentStatus = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']
const dealTypes = ['SALE', 'RENT']
export const dealStatus = ['DRAFT', 'PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']
export const initialDealStatuses = ['DRAFT', 'PENDING', 'ACTIVE']

/** Mirrors the API's forward-only deal lifecycle. */
export const dealTransitions: Record<string, string[]> = {
  DRAFT: ['PENDING', 'ACTIVE', 'CANCELLED'],
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
}
const paymentStatus = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']
const expenseStatus = ['PENDING', 'PAID', 'CANCELLED']
const commissionStatus = ['PENDING', 'APPROVED', 'PAID', 'CANCELLED']
const maintenanceStatus = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
const maintenancePriority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const roles = ['ADMIN', 'MANAGER', 'AGENT', 'ACCOUNTANT', 'TEAM_LEAD']
const rolesAr = ['مدير عام', 'مدير', 'وكيل', 'محاسب', 'قائد الفريق']

export const resources: Record<string, ResourceConfig> = {
  leads: {
    endpoint: '/leads',
    title: 'Leads',
    titleAr: 'العملاء المحتملون',
    fields: [
      { key: 'firstName', label: 'First name', type: 'text', required: true },
      { key: 'lastName', label: 'Last name', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: leadStatus, default: 'NEW' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'budgetMin', label: 'Budget min', type: 'number' },
      { key: 'budgetMax', label: 'Budget max', type: 'number' },
      { key: 'preferredType', label: 'Preferred property type', type: 'select', options: propertyTypes },
      { key: 'preferredCity', label: 'Preferred city/area', type: 'text' },
      { key: 'preferredBedrooms', label: 'Preferred bedrooms', type: 'number' },
      { key: 'preferredAreaMin', label: 'Preferred area min', type: 'number' },
      { key: 'preferredAreaMax', label: 'Preferred area max', type: 'number' },
      { key: 'propertyId', label: 'Property ID', type: 'text' },
      { key: 'assignedToId', label: 'Assigned user ID', type: 'text' },
      { key: 'branchId', label: 'Branch ID', labelAr: 'معرّف الفرع', type: 'text' },
      { key: 'teamId', label: 'Team ID', labelAr: 'معرّف الفريق', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'lastContactedAt', label: 'Last contacted', type: 'datetime-local' },
      { key: 'nextFollowUpAt', label: 'Next follow-up', type: 'datetime-local' }
    ],
    columns: [
      { key: 'firstName', label: 'First name' },
      { key: 'lastName', label: 'Last name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'source', label: 'Source' },
      { key: 'priorityTier', label: 'Priority' },
      { key: 'priorityScore', label: 'Score' },
      { key: 'lastContactedAt', label: 'Last contacted', date: true },
      { key: 'nextFollowUpAt', label: 'Next follow-up', date: true },
      { key: 'createdAt', label: 'Created', date: true }
    ],
    deletable: true
  },
  appointments: {
    endpoint: '/appointments',
    title: 'Appointments',
    titleAr: 'المواعيد',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', options: appointmentTypes, default: 'VIEWING' },
      { key: 'status', label: 'Status', type: 'select', options: appointmentStatus, default: 'SCHEDULED' },
      { key: 'startsAt', label: 'Starts at', type: 'datetime-local', required: true },
      { key: 'endsAt', label: 'Ends at', type: 'datetime-local' },
      { key: 'propertyId', label: 'Property ID', type: 'text' },
      { key: 'leadId', label: 'Lead ID', type: 'text' },
      { key: 'userId', label: 'User ID', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'startsAt', label: 'Starts', date: true },
      { key: 'endsAt', label: 'Ends', date: true },
      { key: 'notes', label: 'Outcome / notes' }
    ],
    deletable: true
  },
  deals: {
    endpoint: '/deals',
    title: 'Deals',
    titleAr: 'الصفقات',
    fields: [
      { key: 'referenceNumber', label: 'Reference', type: 'text' },
      { key: 'type', label: 'Type', type: 'select', options: dealTypes, default: 'SALE' },
      { key: 'status', label: 'Status', type: 'select', options: dealStatus, default: 'DRAFT' },
      { key: 'propertyId', label: 'Property ID', type: 'text', required: true },
      { key: 'leadId', label: 'Lead ID', type: 'text' },
      { key: 'userId', label: 'User ID', type: 'text', required: true },
      { key: 'branchId', label: 'Branch ID', labelAr: 'معرّف الفرع', type: 'text' },
      { key: 'teamId', label: 'Team ID', labelAr: 'معرّف الفريق', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'currency', label: 'Currency', type: 'text', default: 'USD' },
      { key: 'exchangeRate', label: 'Historical exchange rate', type: 'number' },
      { key: 'startedAt', label: 'Started at', type: 'date' },
      { key: 'dueAt', label: 'Due at', type: 'date' },
      { key: 'closedAt', label: 'Closed at', type: 'date' },
      { key: 'leaseStartAt', label: 'Lease start', type: 'date' },
      { key: 'leaseEndAt', label: 'Lease end', type: 'date' },
      { key: 'renewalNoticeDays', label: 'Renewal notice (days)', type: 'number', default: 30 },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    columns: [
      { key: 'referenceNumber', label: 'Reference' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount', money: true },
      { key: 'dueAt', label: 'Due', date: true },
      { key: 'leaseEndAt', label: 'Lease ends', date: true },
      { key: 'closedAt', label: 'Closed', date: true }
    ],
    deletable: true,
    deletableRoles: ['ADMIN', 'MANAGER']
  },
  payments: {
    endpoint: '/finance/payments',
    title: 'Payments',
    titleAr: 'المدفوعات',
    fields: [
      { key: 'dealId', label: 'Deal ID', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'currency', label: 'Currency', type: 'text', default: 'USD' },
      { key: 'exchangeRate', label: 'Historical exchange rate', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: paymentStatus, default: 'PENDING' },
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'idempotencyKey', label: 'Idempotency key', type: 'text' },
      { key: 'dueAt', label: 'Due date', type: 'date' },
      { key: 'paidAt', label: 'Paid at', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    columns: [
      { key: 'dealId', label: 'Deal ID' },
      { key: 'amount', label: 'Amount', money: true },
      { key: 'baseAmount', label: 'Base amount', money: true },
      { key: 'status', label: 'Status' },
      { key: 'aging', label: 'Aging' },
      { key: 'method', label: 'Method' },
      { key: 'dueAt', label: 'Due', date: true },
      { key: 'paidAt', label: 'Paid', date: true }
    ],
    deletable: false
  },
  expenses: {
    endpoint: '/finance/expenses',
    title: 'Expenses',
    titleAr: 'المصروفات',
    fields: [
      { key: 'category', label: 'Category', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'currency', label: 'Currency', type: 'text', default: 'USD' },
      { key: 'exchangeRate', label: 'Historical exchange rate', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: expenseStatus, default: 'PENDING' },
      { key: 'spentAt', label: 'Spent at', type: 'date' },
      { key: 'propertyId', label: 'Property ID', type: 'text' },
      { key: 'dealId', label: 'Deal ID', type: 'text' }
    ],
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount', money: true },
      { key: 'baseAmount', label: 'Base amount', money: true },
      { key: 'status', label: 'Status' },
      { key: 'spentAt', label: 'Spent', date: true }
    ],
    deletable: true
  },
  commissions: {
    endpoint: '/finance/commissions',
    title: 'Commissions',
    titleAr: 'العمولات',
    fields: [
      { key: 'dealId', label: 'Deal ID', type: 'text', required: true },
      { key: 'userId', label: 'User ID', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'text', default: 'USD' },
      { key: 'rate', label: 'Rate', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: commissionStatus, default: 'PENDING' },
      { key: 'paymentReference', label: 'Payment reference', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    columns: [
      { key: 'dealId', label: 'Deal ID' },
      { key: 'userId', label: 'User ID' },
      { key: 'amount', label: 'Amount', money: true },
      { key: 'rate', label: 'Rate' },
      { key: 'status', label: 'Status' }
    ],
    deletable: true
  },
  maintenance: {
    endpoint: '/maintenance',
    title: 'Maintenance',
    titleAr: 'الصيانة',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'propertyId', label: 'Property ID', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'priority', label: 'Priority', type: 'select', options: maintenancePriority, default: 'MEDIUM' },
      { key: 'status', label: 'Status', type: 'select', options: maintenanceStatus, default: 'OPEN' },
      { key: 'assignedToId', label: 'Assigned user ID', type: 'text' },
      { key: 'cost', label: 'Cost', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'text', default: 'USD' },
      { key: 'dueAt', label: 'Due at', type: 'date' },
      { key: 'recurrenceInterval', label: 'Recurrence', type: 'select', options: ['NONE', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL'], default: 'NONE' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'property', label: 'Property' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'cost', label: 'Cost', money: true },
      { key: 'dueAt', label: 'Due', date: true },
      { key: 'nextDueAt', label: 'Next due', date: true }
    ],
    deletable: true,
    deletableRoles: ['ADMIN', 'MANAGER']
  },
  users: {
    endpoint: '/users',
    title: 'Users',
    titleAr: 'المستخدمون',
    fields: [
      { key: 'email', label: 'Email', labelAr: 'البريد الإلكتروني', type: 'email', required: true },
      { key: 'password', label: 'Password', labelAr: 'كلمة المرور', type: 'password', required: true, createOnly: true },
      { key: 'firstName', label: 'First name', labelAr: 'الاسم الأول', type: 'text' },
      { key: 'role', label: 'Role', labelAr: 'الدور', type: 'select', options: roles, optionsAr: rolesAr, default: 'AGENT' },
      { key: 'branchId', label: 'Branch ID', labelAr: 'معرّف الفرع', type: 'text' },
      { key: 'teamId', label: 'Team ID', labelAr: 'معرّف الفريق', type: 'text' },
      { key: 'isActive', label: 'Active', labelAr: 'نشط', type: 'checkbox', default: true }
    ],
    columns: [
      { key: 'email', label: 'Email', labelAr: 'البريد الإلكتروني' },
      { key: 'firstName', label: 'First name', labelAr: 'الاسم الأول' },
      { key: 'role', label: 'Role', labelAr: 'الدور' },
      { key: 'branchId', label: 'Branch', labelAr: 'الفرع' },
      { key: 'teamId', label: 'Team', labelAr: 'الفريق' },
      { key: 'isActive', label: 'Active', labelAr: 'نشط' },
      { key: 'lastLoginAt', label: 'Last login', labelAr: 'آخر دخول', date: true }
    ],
    deletable: false
  }
}
