/**
 * Rich, deterministic sample data for the standalone GitHub Pages live demo.
 * No backend, PostgreSQL server or network request is required: this data is
 * generated in the browser and persisted in localStorage for the session.
 */

export const DEMO_ORG_ID = 'demo-org-estateos'
export const DEMO_PASSWORD = 'EstateDemo2026!'
export const DEMO_STORAGE_KEY = 'estateos.demo.database.v1'

/** One-click demo logins shown on the sign-in screen. */
export const DEMO_LOGIN_ACCOUNTS = [
  { email: 'demo.admin@estateos.local', label: 'Administrator', labelAr: 'مدير النظام' },
  { email: 'demo.manager@estateos.local', label: 'Manager', labelAr: 'مدير المبيعات' },
  { email: 'demo.teamlead@estateos.local', label: 'Team lead', labelAr: 'قائد الفريق' },
  { email: 'demo.agent@estateos.local', label: 'Agent', labelAr: 'وكيل عقاري' },
  { email: 'demo.accountant@estateos.local', label: 'Accountant', labelAr: 'محاسب' }
] as const

export type DemoRow = Record<string, any>

export interface DemoDatabase {
  users: DemoRow[]
  owners: DemoRow[]
  properties: DemoRow[]
  leads: DemoRow[]
  appointments: DemoRow[]
  deals: DemoRow[]
  payments: DemoRow[]
  expenses: DemoRow[]
  commissions: DemoRow[]
  maintenance: DemoRow[]
  documents: DemoRow[]
  notifications: DemoRow[]
  referralPartners: DemoRow[]
  referralSplits: DemoRow[]
  contractTemplates: DemoRow[]
  followUpRules: DemoRow[]
  followUpTasks: DemoRow[]
  branches: DemoRow[]
  teams: DemoRow[]
  ownerPayouts: DemoRow[]
  webhookEndpoints: DemoRow[]
  webhookDeliveries: DemoRow[]
  activity: DemoRow[]
  settings: DemoRow
  branding: DemoRow
  quotas: DemoRow
  fx: DemoRow
  permissions: DemoRow
  whatsappTemplates: DemoRow
  currentUserId: string
}

const DAY = 86_400_000

function iso(offsetDays: number, hour = 10): string {
  const date = new Date(Date.now() + offsetDays * DAY)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

function imageDataUrl(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},68%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 38) % 360},58%,42%)"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><path d="M0 300 L180 190 L320 280 L460 160 L640 270 L640 400 L0 400 Z" fill="rgba(255,255,255,.28)"/><circle cx="520" cy="80" r="42" fill="rgba(255,255,255,.55)"/><text x="32" y="366" fill="#fff" font-size="26" font-family="sans-serif" font-weight="700">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const agentSummaries = [
  { id: 'demo-user-admin', firstName: 'Layla', lastName: 'Hassan', email: 'demo.admin@estateos.local', role: 'ADMIN', jobTitle: 'Operations Director / مدير العمليات', phone: '+20 100 111 0101', monthlyTargetAmount: 0 },
  { id: 'demo-user-manager', firstName: 'Omar', lastName: 'Farouk', email: 'demo.manager@estateos.local', role: 'MANAGER', jobTitle: 'Sales Manager / مدير المبيعات', phone: '+20 100 111 0202', monthlyTargetAmount: 750000 },
  { id: 'demo-user-team-lead', firstName: 'Salma', lastName: 'Nabil', email: 'demo.teamlead@estateos.local', role: 'TEAM_LEAD', jobTitle: 'Team Lead / قائد فريق', phone: '+20 100 222 3322', monthlyTargetAmount: 400000 },
  { id: 'demo-user-agent', firstName: 'Karim', lastName: 'Adel', email: 'demo.agent@estateos.local', role: 'AGENT', jobTitle: 'Senior Agent / وكيل أول', phone: '+20 100 222 3311', monthlyTargetAmount: 250000 },
  { id: 'demo-user-agent-2', firstName: 'Nour', lastName: 'Magdy', email: 'demo.agent2@estateos.local', role: 'AGENT', jobTitle: 'Agent / وكيل', phone: '+20 100 333 4455', monthlyTargetAmount: 220000 },
  { id: 'demo-user-accountant', firstName: 'Youssef', lastName: 'Ali', email: 'demo.accountant@estateos.local', role: 'ACCOUNTANT', jobTitle: 'Accountant / محاسب', phone: '+20 100 444 5566', monthlyTargetAmount: 0 }
]

const propertySeeds: Array<Array<string | number>> = [
  ['Villa Est', 'VILLA', 'AVAILABLE', 'Cairo', 'New Cairo', 'USD', 485000, 5, 4, 320, 'Garden, private pool, smart home | حديقة، مسبح خاص، منزل ذكي', '20% down, 5 years | ٢٠٪ مقدمة، ٥ سنوات', 'RESIDENTIAL'],
  ['Skyline Apartment', 'APARTMENT', 'AVAILABLE', 'Cairo', 'Zamalek', 'USD', 265000, 3, 2, 165, 'River view, furnished, elevator | إطلالة على النيل، مفروش، مصعد', '15% down, 3 years | ١٥٪ مقدمة، ٣ سنوات', 'RESIDENTIAL'],
  ['Palm Resort Townhouse', 'TOWNHOUSE', 'UNDER_NEGOTIATION', 'Giza', '6th of October', 'EGP', 7200000, 4, 3, 240, 'Gated community, shared pool | مجتمع متكامل، مسبح مشترك', 'Bank mortgage available | تمويل بنكي متاح', 'RESIDENTIAL'],
  ['Marina Penthouse', 'CONDO', 'AVAILABLE', 'Alexandria', 'Marina', 'USD', 390000, 4, 3, 210, 'Sea view, terrace, parking | إطلالة بحرية، تراس، موقف', '25% down, 4 years | ٢٥٪ مقدمة، ٤ سنوات', 'RESIDENTIAL'],
  ['Business Tower Office', 'COMMERCIAL', 'AVAILABLE', 'Cairo', 'CBD', 'USD', 610000, 0, 3, 340, 'Fitted out, 24/7 security | مجهز، أمن على مدار الساعة', 'Lease 3 years | إيجار ٣ سنوات', 'COMMERCIAL'],
  ['Nile View Duplex', 'APARTMENT', 'SOLD', 'Cairo', 'Maadi', 'USD', 310000, 3, 3, 188, 'Duplex, roof terrace | دوبلكس، تراس علوي', 'Paid in full | سداد كامل', 'RESIDENTIAL'],
  ['Garden Family House', 'HOUSE', 'AVAILABLE', 'Giza', 'Sheikh Zayed', 'EGP', 9500000, 5, 4, 360, 'Corner plot, garden, nanny room | أرض زاوية، حديقة، غرفة خادمة', '30% down, 6 years | ٣٠٪ مقدمة، ٦ سنوات', 'RESIDENTIAL'],
  ['Downtown Studio', 'APARTMENT', 'RENTED', 'Dubai', 'Downtown', 'AED', 98000, 1, 1, 62, 'Furnished, billable monthly | مفروش، فاتورة شهرية', '12 cheques | ١٢ شيك', 'RESIDENTIAL'],
  ['Riyadh Corner Land', 'LAND', 'AVAILABLE', 'Riyadh', 'Al Malqa', 'SAR', 1450000, 0, 0, 1200, 'Corner lot, residential permit | أرض زاوية، رخصة سكنية', 'Cash or bank transfer | نقد أو تحويل بنكي', 'LAND'],
  ['Seaside Chalet', 'VILLA', 'RESERVED', 'Alexandria', 'Sidi Abdel Rahman', 'USD', 220000, 3, 2, 145, 'Beach access, sea view | شاطئ خاص، إطلالة بحرية', '10% reservation | ١٠٪ حجز', 'RESIDENTIAL'],
  ['Modern Loft', 'CONDO', 'AVAILABLE', 'Dubai', 'Business Bay', 'AED', 165000, 2, 2, 105, 'Loft, gym, concierge | لوف، صالة رياضية، كونسيرج', 'Post-handover plan | خطة ما بعد التسليم', 'RESIDENTIAL'],
  ['Investment Shop', 'COMMERCIAL', 'OFF_MARKET', 'Cairo', 'Heliopolis', 'USD', 180000, 0, 1, 85, 'High footfall, corner unit | حركة مرور عالية، واجهة', 'Owner financing | تمويل من المالك', 'COMMERCIAL']
]

/**
 * Package 44: per-property development and unit pin metadata. Coordinates
 * cover Greater Cairo, Sheikh Zayed, 6th of October, New Cairo and the North
 * Coast so the live availability map is useful without any network tiles.
 */
const mapSeeds: Array<{
  projectName: string
  buildingName: string
  unitNumber: string
  cityArea: string
  latitude: number
  longitude: number
  mapX: number
  mapY: number
  masterplanImageUrl: string
}> = [
  { projectName: 'Cairo Gardens Residence', buildingName: 'Block C', unitNumber: 'CG-C-301', cityArea: 'Fifth Settlement / التجمع الخامس', latitude: 30.0259, longitude: 31.4912, mapX: 38, mapY: 44, masterplanImageUrl: '/demo/masterplans/cairo-gardens.svg' },
  { projectName: 'Skyline Residence', buildingName: 'Tower A', unitNumber: 'SZ-A-101', cityArea: 'Zamalek, Greater Cairo / الزمالك، القاهرة الكبرى', latitude: 30.0626, longitude: 31.2224, mapX: 28, mapY: 32, masterplanImageUrl: '/demo/masterplans/skyline-residence.svg' },
  { projectName: 'Palm Valley Residence', buildingName: 'Block 2', unitNumber: 'PV-2-14', cityArea: '6th of October / السادس من أكتوبر', latitude: 29.9336, longitude: 31.0925, mapX: 62, mapY: 55, masterplanImageUrl: '/demo/masterplans/october-family-villas.svg' },
  { projectName: 'North Coast Marina Village', buildingName: 'Marina 3', unitNumber: 'MV-3-08', cityArea: 'Sidi Abdel Rahman, North Coast / سيدي عبد الرحمن، الساحل الشمالي', latitude: 30.9865, longitude: 28.8115, mapX: 45, mapY: 38, masterplanImageUrl: '/demo/masterplans/north-coast-marina.svg' },
  { projectName: 'November Business Hub', buildingName: 'Tower 1', unitNumber: 'OFF-82', cityArea: 'November 6th Axis / محور ٦ نوفمبر', latitude: 30.0444, longitude: 31.2357, mapX: 52, mapY: 50, masterplanImageUrl: '/demo/masterplans/november-business-hub.svg' },
  { projectName: 'Nile View Compound', buildingName: 'Building 4', unitNumber: 'NV-4-22', cityArea: 'Maadi, Greater Cairo / المعادي، القاهرة الكبرى', latitude: 29.9602, longitude: 31.2759, mapX: 70, mapY: 26, masterplanImageUrl: '/demo/masterplans/skyline-residence.svg' },
  { projectName: 'Skyline Residence', buildingName: 'Block B', unitNumber: 'SZ-B-201', cityArea: 'Sheikh Zayed / الشيخ زايد', latitude: 30.0197, longitude: 31.0089, mapX: 66, mapY: 62, masterplanImageUrl: '/demo/masterplans/skyline-residence.svg' },
  { projectName: 'Downtown Towers', buildingName: 'Tower 7', unitNumber: 'DT-7-12', cityArea: 'Downtown / وسط المدينة', latitude: 25.1972, longitude: 55.2744, mapX: 40, mapY: 47, masterplanImageUrl: '/demo/masterplans/cairo-gardens.svg' },
  { projectName: 'Al Malqa Land', buildingName: 'Plot 9', unitNumber: 'LM-9', cityArea: 'Al Malqa / الملقا', latitude: 24.8067, longitude: 46.6094, mapX: 55, mapY: 60, masterplanImageUrl: '/demo/masterplans/cairo-gardens.svg' },
  { projectName: 'North Coast Marina Village', buildingName: 'Marina 4', unitNumber: 'MV-4-12', cityArea: 'Sidi Abdel Rahman / سيدي عبد الرحمن', latitude: 30.9865, longitude: 28.8115, mapX: 62, mapY: 35, masterplanImageUrl: '/demo/masterplans/north-coast-marina.svg' },
  { projectName: 'Business Bay Lofts', buildingName: 'Block B', unitNumber: 'BB-B-09', cityArea: 'Business Bay / الخليج التجاري', latitude: 25.1855, longitude: 55.2648, mapX: 33, mapY: 58, masterplanImageUrl: '/demo/masterplans/cairo-gardens.svg' },
  { projectName: 'Heliopolis Corner', buildingName: 'Street 9', unitNumber: 'HC-9', cityArea: 'Heliopolis / مصر الجديدة', latitude: 30.0818, longitude: 31.3155, mapX: 47, mapY: 41, masterplanImageUrl: '/demo/masterplans/november-business-hub.svg' }
]

const leadSeeds: Array<Array<string | number>> = [
  ['Mohamed', 'Aly', 'NEW', 'Website', 'APARTMENT', 180000, 320000, 'Cairo', 'CONTACTED', 'URGENT'],
  ['Sara', 'Eldin', 'CONTACTED', 'Referral', 'VILLA', 400000, 700000, 'Giza', 'QUALIFIED', 'URGENT'],
  ['Ahmed', 'Ramy', 'QUALIFIED', 'Walk-in', 'HOUSE', 250000, 500000, 'Cairo', 'VIEWING', 'HIGH'],
  ['Nadia', 'Samir', 'VIEWING', 'Portal', 'CONDO', 120000, 240000, 'Alexandria', 'NEGOTIATION', 'HIGH'],
  ['Khaled', 'Nasser', 'NEGOTIATION', 'Website', 'COMMERCIAL', 300000, 900000, 'Cairo', 'WON', 'HIGH'],
  ['Dina', 'Fahmy', 'NEW', 'Social media', 'TOWNHOUSE', 150000, 280000, 'Giza', 'NEW', 'MEDIUM'],
  ['Yasmine', 'Kamel', 'CONTACTED', 'Campaign', 'APARTMENT', 90000, 180000, 'Dubai', 'CONTACTED', 'MEDIUM'],
  ['Tarek', 'Zaki', 'QUALIFIED', 'Referral', 'LAND', 200000, 450000, 'Riyadh', 'QUALIFIED', 'HIGH'],
  ['Rania', 'Hosny', 'NEW', 'Website', 'APARTMENT', 110000, 200000, 'Cairo', 'NEW', 'MEDIUM'],
  ['Mostafa', 'Gaber', 'LOST', 'Portal', 'VILLA', 500000, 800000, 'Alexandria', 'LOST', 'LOW'],
  ['Hana', 'Refaat', 'VIEWING', 'Walk-in', 'CONDO', 140000, 260000, 'Dubai', 'VIEWING', 'MEDIUM'],
  ['Wael', 'Sabry', 'CONTACTED', 'Campaign', 'HOUSE', 350000, 600000, 'Giza', 'CONTACTED', 'HIGH'],
  ['Mona', 'Amin', 'QUALIFIED', 'Referral', 'APARTMENT', 160000, 300000, 'Cairo', 'QUALIFIED', 'MEDIUM'],
  ['Fady', 'Bishay', 'NEW', 'Social media', 'COMMERCIAL', 220000, 480000, 'Cairo', 'NEW', 'LOW']
]

const statusScores: Record<string, number> = {
  NEW: 92, CONTACTED: 84, QUALIFIED: 78, VIEWING: 72, NEGOTIATION: 66, WON: 60, LOST: 20
}
const tierFor = (status: string, index: number) => {
  const score = statusScores[status] ?? (60 - index)
  return { priorityScore: score, priorityTier: score >= 75 ? 'URGENT' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW' }
}

function buildProperties(): DemoRow[] {
  return propertySeeds.map((seed, index) => {
    const [title, type, status, city, address, currency, price, bedrooms, bathrooms, area, features, paymentTerms, classification] = seed
    const hue = (index * 47 + 190) % 360
    const map = mapSeeds[index % mapSeeds.length]
    return {
      id: `demo-property-${index + 1}`,
      referenceNumber: `EST-${String(1042 + index)}`,
      title: index % 4 === 0 ? `${title} · فيلا فاخرة` : title,
      description: index % 4 === 0
        ? 'Spacious, sunlit home with premium finishes. قريب من الخدمات والمواصلات مع تشطيبات فاخرة.'
        : 'Bright, well-maintained property in a prime location. موقع متميز وتشطيبات عالية الجودة.',
      type, status, classification,
      address, city,
      state: address,
      country: city === 'Dubai' ? 'UAE' : city === 'Riyadh' ? 'Saudi Arabia' : 'Egypt',
      postalCode: String(11000 + index * 37),
      latitude: map.latitude,
      longitude: map.longitude,
      // Package 44: project-level masterplan identity and per-unit pin position.
      projectName: map.projectName,
      buildingName: map.buildingName,
      unitNumber: map.unitNumber,
      cityArea: map.cityArea,
      masterplanImageUrl: map.masterplanImageUrl,
      mapX: map.mapX,
      mapY: map.mapY,
      unitLatitude: Number((map.latitude + ((index % 3) - 1) * 0.00035).toFixed(6)),
      unitLongitude: Number((map.longitude + (index % 2 ? 0.0004 : -0.0004)).toFixed(6)),
      area, areaUnit: 'SQ_M',
      bedrooms, bathrooms, floors: bedrooms ? 2 : 1,
      yearBuilt: 2014 + (index % 11),
      condition: index % 3 === 0 ? 'EXCELLENT' : 'GOOD',
      price, currency,
      negotiable: index % 3 === 0,
      featured: index < 4,
      availableFrom: iso(index - 2),
      occupancyStatus: status === 'RENTED' ? 'OCCUPIED' : 'VACANT',
      features, paymentTerms,
      organizationId: DEMO_ORG_ID,
      ownerId: `demo-owner-${(index % 4) + 1}`,
      assignedAgentId: ['demo-user-agent', 'demo-user-agent-2', 'demo-user-team-lead'][index % 3],
      createdAt: iso(-index * 4 - 2),
      updatedAt: iso(-index),
      images: [
        { id: `demo-image-${index + 1}`, propertyId: `demo-property-${index + 1}`, url: imageDataUrl(String(title), hue), contentUrl: imageDataUrl(String(title), hue), caption: `${title} — main view`, originalName: `${title}.svg`, mimeType: 'image/svg+xml', size: 2048, isPrimary: true, sortOrder: 0 },
        { id: `demo-image-b-${index + 1}`, propertyId: `demo-property-${index + 1}`, url: imageDataUrl(`${title} 2`, hue + 25), contentUrl: imageDataUrl(`${title} 2`, hue + 25), caption: `${title} — interior`, originalName: `${title}-2.svg`, mimeType: 'image/svg+xml', size: 2048, isPrimary: false, sortOrder: 1 }
      ],
      attachments: [
        { id: `demo-attachment-${index + 1}`, name: `${title} floorplan`, originalName: 'floorplan.pdf', url: '#', contentUrl: '#', kind: 'FLOORPLAN', mimeType: 'application/pdf', size: 145000, sortOrder: 0 }
      ]
    }
  })
}

function buildLeads(properties: DemoRow[]): DemoRow[] {
  return leadSeeds.map((seed, index) => {
    const [firstName, lastName, status, source, preferredType, budgetMin, budgetMax, preferredCity, , priority] = seed
    const derived = tierFor(String(status), index)
    return {
      id: `demo-lead-${index + 1}`,
      firstName, lastName,
      email: `${String(firstName).toLowerCase()}.${String(lastName).toLowerCase()}@example.com`,
      phone: `+20 10${String(200 + index).padStart(3, '0')} ${String(1000 + index * 37).slice(0, 4)}`,
      status, source,
      priorityScore: derived.priorityScore,
      priorityTier: priority,
      notes: 'Prefers a quick response and bilingual documentation. يفضل الرد السريع والمستندات ثنائية اللغة.',
      budgetMin, budgetMax,
      preferredType, preferredCity,
      preferredBedrooms: 2 + (index % 4),
      preferredAreaMin: 90 + index * 8,
      preferredAreaMax: 220 + index * 12,
      assignedToId: ['demo-user-agent', 'demo-user-agent-2', 'demo-user-team-lead'][index % 3],
      propertyId: properties[index % properties.length].id,
      nextFollowUpAt: iso(index % 5 - 1, 9),
      lastContactedAt: index % 4 === 0 ? null : iso(-index - 1),
      portalEnabled: index % 3 === 0,
      followUpNotes: index % 2 === 0 ? [{ id: `demo-note-${index + 1}`, leadId: `demo-lead-${index + 1}`, body: 'Called and confirmed interest.', authorId: 'demo-user-agent', createdAt: iso(-2), author: { id: 'demo-user-agent', firstName: 'Karim', email: 'demo.agent@estateos.local' } }] : [],
      isActive: status !== 'LOST',
      createdAt: iso(-index * 2 - 1),
      updatedAt: iso(-index),
      organizationId: DEMO_ORG_ID
    }
  })
}

function buildDeals(properties: DemoRow[], leads: DemoRow[]): DemoRow[] {
  const types = ['SALE', 'RENT', 'SALE', 'SALE', 'RENT', 'SALE', 'SALE', 'RENT']
  const statuses = ['ACTIVE', 'COMPLETED', 'PENDING', 'ACTIVE', 'COMPLETED', 'ACTIVE', 'DRAFT', 'ACTIVE']
  return types.map((type, index) => {
    const property = properties[index % properties.length]
    const lead = leads[index % leads.length]
    const amount = Math.round(Number(property.price) * (type === 'RENT' ? 0.18 : 0.94))
    const user = agentSummaries[[3, 2, 4, 3, 1, 4, 2, 3][index]]
    return {
      id: `demo-deal-${index + 1}`,
      referenceNumber: `DEAL-${String(2301 + index)}`,
      type, status: statuses[index],
      propertyId: property.id,
      leadId: lead.id,
      userId: user.id,
      organizationId: DEMO_ORG_ID,
      amount, baseAmount: amount,
      exchangeRate: 1,
      currency: property.currency,
      startedAt: iso(-40 + index * 3),
      dueAt: iso(20 + index * 5),
      closedAt: statuses[index] === 'COMPLETED' ? iso(-5 - index) : null,
      leaseStartAt: type === 'RENT' ? iso(-10) : null,
      leaseEndAt: type === 'RENT' ? iso(300 + index * 10) : null,
      renewalNoticeDays: type === 'RENT' ? 30 : null,
      notes: 'Client contacted through the live demo. العميل تواصل عبر العرض التجريبي.',
      portalEnabled: true,
      createdAt: iso(-40 + index * 3),
      updatedAt: iso(-index),
      property: { id: property.id, title: property.title, referenceNumber: property.referenceNumber, city: property.city, address: property.address },
      user: { id: user.id, email: user.email, firstName: user.firstName, role: user.role },
      lead: { id: lead.id, firstName: lead.firstName, lastName: lead.lastName },
      closingChecklist: ['CONTRACT', 'DEPOSIT', 'ID_VERIFICATION', 'HANDOVER'].map((itemKey, i) => ({
        id: `demo-check-${index + 1}-${i}`,
        itemKey,
        label: itemKey.replace('_', ' '),
        isCompleted: i < (statuses[index] === 'COMPLETED' ? 4 : index % 4),
        completedAt: i < 2 ? iso(-3) : null,
        completedById: user.id
      }))
    }
  })
}

function buildPayments(deals: DemoRow[]): DemoRow[] {
  const buckets = ['CURRENT', '1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'PAID']
  const rows: DemoRow[] = []
  deals.forEach((deal, dealIndex) => {
    for (let i = 0; i < 2 + (dealIndex % 2); i += 1) {
      const bucket = buckets[(dealIndex + i) % buckets.length]
      const paid = bucket === 'PAID'
      const index = rows.length + 1
      rows.push({
        id: `demo-payment-${index}`,
        dealId: deal.id,
        amount: Math.round(Number(deal.amount) / (4 + i)),
        baseAmount: Math.round(Number(deal.amount) / (4 + i)),
        exchangeRate: 1,
        currency: deal.currency,
        status: paid ? 'COMPLETED' : 'PENDING',
        method: i % 2 === 0 ? 'BANK_TRANSFER' : 'CASH',
        reference: `PAY-${String(5500 + index)}`,
        notes: bucket === '60_PLUS_DAYS' ? 'Follow up with client. يرجى المتابعة مع العميل.' : '',
        dueAt: iso((i - 2) * 22),
        paidAt: paid ? iso(-i * 3) : null,
        createdAt: iso(-30 - i * 5),
        organizationId: DEMO_ORG_ID,
        aging: { bucket, daysPastDue: bucket === 'PAID' ? 0 : (i + dealIndex) * 11 }
      })
    }
  })
  return rows
}

function buildCommissionStatements(commissions: DemoRow[], users: DemoRow[]) {
  const statuses = ['PENDING', 'APPROVED', 'PAID']
  const currencies = Array.from(new Set(commissions.map((row) => String(row.currency))))
  const lines: DemoRow[] = []
  for (const user of users.filter((u) => u.role === 'AGENT' || u.role === 'TEAM_LEAD' || u.role === 'MANAGER')) {
    for (const currency of currencies) {
      for (const status of statuses) {
        const matching = commissions.filter((row) => row.userId === user.id && row.currency === currency && row.status === status)
        if (!matching.length) continue
        lines.push({
          agentId: user.id,
          agentName: `${user.firstName} ${user.lastName || ''}`.trim(),
          status, currency,
          count: matching.length,
          amount: String(matching.reduce((sum, row) => sum + Number(row.amount), 0)),
          baseAmount: String(matching.reduce((sum, row) => sum + Number(row.amount), 0))
        })
      }
    }
  }
  const totals = statuses.flatMap((status) => currencies.map((currency) => ({
    status, currency,
    count: lines.filter((line) => line.status === status && line.currency === currency).reduce((sum, line) => sum + line.count, 0),
    amount: String(lines.filter((line) => line.status === status && line.currency === currency).reduce((sum, line) => sum + Number(line.amount), 0))
  }))).filter((row) => row.count > 0)
  return {
    lines, totals,
    fxRows: currencies.map((currency) => ({ currency, amount: String(commissions.filter((row) => row.currency === currency).reduce((sum, row) => sum + Number(row.amount), 0)) })),
    fx: { baseCurrency: 'USD', missingCurrencies: [], convertedTotal: '0' },
    scope: 'ALL',
    agentId: null,
    commissionCount: commissions.length
  }
}

export function createDemoDatabase(): DemoDatabase {
  const users = agentSummaries.map((user) => ({
    ...user,
    organizationId: DEMO_ORG_ID,
    accountStatus: 'ACTIVE',
    isActive: true,
    preferredLang: 'en',
    avatarUrl: null,
    loginCount: 12,
    lastLoginAt: iso(-1),
    createdAt: iso(-360),
    deletedAt: null
  }))

  const owners = [
    { firstName: 'Nagwa', lastName: 'Fahmy', companyName: null, email: 'nagwa@example.com', city: 'Cairo', country: 'Egypt' },
    { firstName: 'Adel', lastName: 'Shoukry', companyName: null, email: 'adel@example.com', city: 'Alexandria', country: 'Egypt' },
    { firstName: null, lastName: null, companyName: 'Gulf Property Holdings', email: 'info@gulfproperties.example', city: 'Dubai', country: 'UAE' },
    { firstName: 'Reem', lastName: 'Khalid', companyName: null, email: 'reem@example.com', city: 'Riyadh', country: 'Saudi Arabia' }
  ].map((owner, index) => ({
    ...owner,
    id: `demo-owner-${index + 1}`,
    displayName: owner.companyName || `${owner.firstName} ${owner.lastName}`,
    phone: `+20 122 ${String(300 + index).padStart(3, '0')} ${String(4000 + index).slice(0, 4)}`,
    address: `${index + 12} Tahrir Street`,
    notes: 'Preferred bilingual contract. يفضل العقد ثنائي اللغة.',
    portalEnabled: true,
    isActive: true,
    organizationId: DEMO_ORG_ID,
    createdAt: iso(-300 + index * 10),
    updatedAt: iso(-index)
  }))

  const properties = buildProperties()
  const leads = buildLeads(properties)
  const deals = buildDeals(properties, leads)
  const payments = buildPayments(deals)
  const commissions: DemoRow[] = deals.flatMap((deal, index) => {
    const user = deal.user
    return [{
      id: `demo-commission-${index + 1}`,
      dealId: deal.id,
      userId: user?.id || 'demo-user-agent',
      amount: Math.round(Number(deal.amount) * 0.025),
      baseAmount: Math.round(Number(deal.amount) * 0.025),
      currency: deal.currency,
      rate: '2.5',
      status: ['PAID', 'PENDING', 'APPROVED'][index % 3],
      notes: 'Standard agent commission. عمولة الوكيل القياسية.',
      approvedAt: index % 3 === 2 ? iso(-4) : null,
      paidAt: index % 3 === 0 ? iso(-2) : null,
      paymentReference: index % 3 === 0 ? `COM-${index + 1}` : null,
      createdAt: iso(-10 - index),
      organizationId: DEMO_ORG_ID
    }]
  })

  const appointments: DemoRow[] = Array.from({ length: 9 }, (_, index) => ({
    id: `demo-appointment-${index + 1}`,
    title: ['Property viewing', 'Client meeting', 'Discovery call'][index % 3],
    type: ['VIEWING', 'MEETING', 'CALL'][index % 3],
    status: ['SCHEDULED', 'COMPLETED', 'SCHEDULED', 'NO_SHOW'][index % 4],
    startsAt: iso(index - 3, 9 + (index % 6)),
    endsAt: iso(index - 3, 10 + (index % 6)),
    notes: index % 4 === 3 ? 'Client did not attend.' : 'Confirmed by phone.',
    userId: users[[3, 2, 4][index % 3]].id,
    propertyId: properties[index % properties.length].id,
    leadId: leads[index % leads.length].id,
    organizationId: DEMO_ORG_ID,
    createdAt: iso(-index - 5),
    updatedAt: iso(-index)
  }))

  const expenses: DemoRow[] = Array.from({ length: 8 }, (_, index) => ({
    id: `demo-expense-${index + 1}`,
    propertyId: properties[index % properties.length].id,
    dealId: null,
    responsibleId: users[3].id,
    category: ['Marketing', 'Maintenance', 'Legal', 'Utilities'][index % 4],
    description: 'Demo operating expense',
    amount: 450 + index * 175,
    baseAmount: 450 + index * 175,
    exchangeRate: 1,
    currency: 'USD',
    status: index % 3 === 0 ? 'PAID' : 'PENDING',
    spentAt: iso(-index * 6),
    paidAt: index % 3 === 0 ? iso(-index * 6 + 1) : null,
    createdAt: iso(-index * 6),
    organizationId: DEMO_ORG_ID
  }))

  const maintenance: DemoRow[] = Array.from({ length: 7 }, (_, index) => ({
    id: `demo-maintenance-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    propertyId: properties[index % properties.length].id,
    title: ['AC inspection', 'Water leak', 'Elevator service', 'Garden landscaping'][index % 4],
    description: 'Scheduled demo maintenance request.',
    priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'][index % 4],
    status: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OPEN'][index % 4],
    recurrenceInterval: index % 3 === 0 ? 'QUARTERLY' : 'NONE',
    nextDueAt: index % 3 === 0 ? iso(60) : null,
    assignedToId: users[3].id,
    createdById: users[0].id,
    cost: 300 + index * 120,
    currency: 'USD',
    dueAt: iso(index - 2),
    completedAt: index % 4 === 2 ? iso(-1) : null,
    createdAt: iso(-index * 3),
    updatedAt: iso(-index),
    property: { id: properties[index % properties.length].id, title: properties[index % properties.length].title, referenceNumber: properties[index % properties.length].referenceNumber },
    assignedTo: { id: users[3].id, firstName: users[3].firstName, email: users[3].email }
  }))

  const documents: DemoRow[] = Array.from({ length: 8 }, (_, index) => ({
    id: `demo-document-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    name: ['Sales contract', 'Title deed', 'ID copy', 'Inspection report'][index % 4],
    originalName: `document-${index + 1}.pdf`,
    storageKey: `demo/documents/${index + 1}.pdf`,
    mimeType: 'application/pdf',
    size: 120000 + index * 8000,
    category: ['CONTRACT', 'LEGAL', 'IDENTITY', 'INSPECTION'][index % 4],
    description: 'Sample document in the live demo.',
    status: 'ACTIVE',
    uploadedById: users[0].id,
    propertyId: properties[index % properties.length].id,
    dealId: deals[index % deals.length].id,
    createdAt: iso(-index * 3),
    updatedAt: iso(-index),
    uploadedBy: { id: users[0].id, firstName: users[0].firstName, email: users[0].email },
    property: { id: properties[index % properties.length].id, title: properties[index % properties.length].title },
    deal: { id: deals[index % deals.length].id, referenceNumber: deals[index % deals.length].referenceNumber }
  }))

  const notifications: DemoRow[] = [
    ['New lead assigned', 'A new urgent lead was assigned to you. تم تعيين عميل عاجل لك.', 'LEAD'],
    ['Payment overdue', 'Payment PAY-5504 is 60+ days overdue. تأخر السداد أكثر من ٦٠ يوماً.', 'PAYMENT'],
    ['Viewing confirmed', 'Marina Penthouse viewing is confirmed for tomorrow. تم تأكيد المعاينة.', 'APPOINTMENT'],
    ['Contract ready', 'Contract for DEAL-2301 is ready for review. العقد جاهز للمراجعة.', 'CONTRACT'],
    ['Referral payout', 'Referral split approved for Gulf Property Holdings. تمت الموافقة على العمولة.', 'REFERRAL'],
    ['Quota warning', 'Your plan is using 82% of property slots. استهلاك الباقات ٨٢٪.', 'QUOTA'],
    ['Maintenance due', 'AC inspection is due in 3 days. الصيانة مستحقة خلال ٣ أيام.', 'MAINTENANCE'],
    ['Welcome to EstateOS Live Demo', 'Explore all modules with rich sample data. استكشف جميع الوحدات ببيانات تجريبية.', 'SYSTEM']
  ].map(([title, message, type], index) => ({
    id: `demo-notification-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    userId: 'demo-user-admin',
    type, title, message,
    entityType: type,
    entityId: `demo-${index + 1}`,
    actionUrl: index % 2 ? '/finance/payments' : '/leads',
    metadata: null,
    isRead: index > 3,
    readAt: index > 3 ? iso(-index) : null,
    createdAt: iso(-index * 0.6)
  }))

  const referralPartners: DemoRow[] = [
    ['Gulf Property Holdings', 'شركة الخليج العقارية', '10', 'info@gulfproperties.example'],
    ['Nile Business Network', 'شبكة النيل للأعمال', '8', 'partners@nilebusiness.example'],
    ['Alexandria Realty Club', 'نادي الإسكندرية العقاري', '12', 'hello@alexrealty.example'],
    ['Riyadh Referral Group', 'مجموعة الرياض للإحالة', '7', 'contact@riyadhreferral.example']
  ].map(([name, nameAr, commissionRate, email], index) => ({
    id: `demo-partner-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    name, nameAr, companyName: name,
    email, phone: `+966 50 ${String(100 + index).padStart(3, '0')} ${String(2000 + index).slice(0, 4)}`,
    commissionRate, notes: 'Active demo referral partner.', isActive: index < 3,
    createdAt: iso(-100 + index * 5)
  }))

  const referralSplits: DemoRow[] = Array.from({ length: 6 }, (_, index) => {
    const partner = referralPartners[index % referralPartners.length]
    const deal = deals[index % deals.length]
    return {
      id: `demo-split-${index + 1}`,
      organizationId: DEMO_ORG_ID,
      dealId: deal.id,
      partnerId: partner.id,
      rate: partner.commissionRate,
      amount: String(Math.round(Number(deal.amount) * Number(partner.commissionRate) / 100)),
      currency: deal.currency,
      status: ['PAID', 'APPROVED', 'PENDING'][index % 3],
      notes: 'Referral split sample.',
      approvedAt: index % 3 !== 2 ? iso(-6) : null,
      paidAt: index % 3 === 0 ? iso(-2) : null,
      partnerName: partner.name,
      dealReference: deal.referenceNumber,
      createdAt: iso(-index - 3)
    }
  })

  const contractTemplates: DemoRow[] = [
    ['Standard Sale Agreement', 'عقد بيع قياسي', 'BILINGUAL'],
    ['Residential Lease', 'عقد إيجار سكني', 'AR'],
    ['Commercial Lease', 'عقد إيجار تجاري', 'EN'],
    ['Reservation Form', 'نموذج حجز', 'BILINGUAL']
  ].map(([name, nameAr, language], index) => ({
    id: `demo-template-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    name, nameAr, language,
    body: 'This agreement is made between {{client_name}} and {{agent_name}} for {{deal_reference}} due {{due_date}}.',
    bodyAr: 'يُبرم هذا العقد بين {{client_name}} و{{agent_name}} بشأن {{deal_reference}} المستحق في {{due_date}}.',
    version: index + 1,
    isActive: true,
    createdAt: iso(-120 + index * 8)
  }))

  const followUpRules: DemoRow[] = [
    ['New lead welcome', 'ترحيب بالعميل الجديد', 'NEW_LEAD', 'WHATSAPP', 0],
    ['48 hour follow-up', 'متابعة بعد ٤٨ ساعة', 'NO_CONTACT', 'NOTIFICATION', 2],
    ['Viewing reminder', 'تذكير بالمعاينة', 'APPOINTMENT_UPCOMING', 'WHATSAPP', 1],
    ['Payment reminder', 'تذكير بالسداد', 'PAYMENT_DUE', 'NOTIFICATION', 3]
  ].map(([name, nameAr, trigger, channel, conditionDays], index) => ({
    id: `demo-rule-${index + 1}`,
    name, nameAr, trigger, channel,
    conditionDays: Number(conditionDays),
    template: 'Hello {{client_name}}, following up on {{deal_reference}} from {{agent_name}}.',
    templateAr: 'مرحباً {{client_name}}، نتابع معك بشأن {{deal_reference}}.',
    priority: index,
    isActive: index < 3,
    createdAt: iso(-60 + index * 3)
  }))

  const followUpTasks: DemoRow[] = Array.from({ length: 7 }, (_, index) => ({
    id: `demo-task-${index + 1}`,
    title: ['Call new lead', 'Send contract', 'Confirm viewing', 'Remind payment'][index % 4],
    titleAr: ['اتصال بالعميل', 'إرسال العقد', 'تأكيد المعاينة', 'تذكير بالسداد'][index % 4],
    status: ['PENDING', 'COMPLETED', 'PENDING', 'CANCELLED'][index % 4],
    dueAt: iso(index - 2),
    rule: { name: followUpRules[index % followUpRules.length].name },
    lead: { firstName: leads[index % leads.length].firstName, lastName: leads[index % leads.length].lastName },
    deal: { referenceNumber: deals[index % deals.length].referenceNumber },
    createdAt: iso(-index - 2)
  }))

  const branches: DemoRow[] = [
    { id: 'demo-branch-main', organizationId: DEMO_ORG_ID, name: 'Main Branch', nameAr: 'الفرع الرئيسي', code: 'MAIN' },
    { id: 'demo-branch-alex', organizationId: DEMO_ORG_ID, name: 'Alexandria Branch', nameAr: 'فرع الإسكندرية', code: 'ALX' }
  ]
  const teams: DemoRow[] = [
    { id: 'demo-team-sales', organizationId: DEMO_ORG_ID, branchId: 'demo-branch-main', name: 'Sales Team', nameAr: 'فريق المبيعات', leaderId: 'demo-user-team-lead' },
    { id: 'demo-team-rentals', organizationId: DEMO_ORG_ID, branchId: 'demo-branch-main', name: 'Rentals Team', nameAr: 'فريق الإيجار', leaderId: 'demo-user-manager' },
    { id: 'demo-team-alex', organizationId: DEMO_ORG_ID, branchId: 'demo-branch-alex', name: 'Coastal Team', nameAr: 'الفريق الساحلي', leaderId: 'demo-user-agent-2' }
  ]

  const ownerPayouts: DemoRow[] = Array.from({ length: 5 }, (_, index) => ({
    id: `demo-payout-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    ownerId: owners[index % owners.length].id,
    amount: 4200 + index * 850,
    currency: 'USD',
    status: ['PENDING', 'SETTLED', 'SETTLED', 'PENDING', 'CANCELLED'][index],
    reference: `PO-${700 + index}`,
    notes: 'Monthly owner remittance.',
    periodStart: iso(-60),
    periodEnd: iso(-30),
    settledAt: index === 1 || index === 2 ? iso(-10) : null,
    createdById: users[5].id,
    createdAt: iso(-20 - index),
    updatedAt: iso(-10)
  }))

  const webhookEndpoints: DemoRow[] = [
    { id: 'demo-webhook-1', organizationId: DEMO_ORG_ID, url: 'https://example.com/webhooks/estateos', events: ['property.created', 'lead.created'], isActive: true, createdById: users[0].id, updatedById: users[0].id, createdAt: iso(-40), updatedAt: iso(-4), deletedAt: null },
    { id: 'demo-webhook-2', organizationId: DEMO_ORG_ID, url: 'https://demo.example.local/hooks', events: ['deal.stage_changed', 'payment.recorded'], isActive: false, createdById: users[0].id, updatedById: users[0].id, createdAt: iso(-25), updatedAt: iso(-9), deletedAt: null }
  ]
  const webhookDeliveries: DemoRow[] = Array.from({ length: 6 }, (_, index) => ({
    id: `demo-delivery-${index + 1}`,
    organizationId: DEMO_ORG_ID,
    endpointId: webhookEndpoints[index % 2].id,
    event: ['property.created', 'lead.created', 'deal.stage_changed', 'payment.recorded'][index % 4],
    eventKey: `evt-demo-${index + 1}`,
    status: ['SUCCESS', 'FAILED', 'RETRYING', 'PENDING'][index % 4],
    attempt: 1 + (index % 3),
    requestUrl: webhookEndpoints[index % 2].url,
    payload: { demo: true, id: `demo-${index + 1}` },
    responseStatus: index % 4 === 1 ? 500 : 200,
    responseBody: index % 4 === 1 ? 'Demo failure' : 'OK',
    error: index % 4 === 1 ? 'Simulated failure' : null,
    createdAt: iso(-index),
    updatedAt: iso(-index),
    deliveredAt: index % 4 === 1 ? null : iso(-index),
    nextRetryAt: index % 4 === 2 ? iso(1) : null
  }))

  const activity: DemoRow[] = Array.from({ length: 18 }, (_, index) => {
    const actor = users[index % users.length]
    const property = properties[index % properties.length]
    return {
      id: `demo-activity-${index + 1}`,
      action: ['PROPERTY_CREATED', 'LEAD_UPDATED', 'DEAL_STAGE_CHANGED', 'PAYMENT_RECORDED'][index % 4],
      entityType: ['PROPERTY', 'LEAD', 'DEAL', 'PAYMENT'][index % 4],
      entityId: property.id,
      timestamp: iso(-index * 0.5),
      actor: { id: actor.id, email: actor.email, firstName: actor.firstName, role: actor.role },
      entity: { id: property.id, label: property.title, meta: { city: property.city, status: property.status }, href: `/properties/${property.id}` },
      metadata: { source: 'Live Demo' },
      changes: [{ field: 'status', before: 'AVAILABLE', after: property.status, changed: true }]
    }
  })

  return {
    users, owners, properties, leads, appointments, deals, payments, expenses, commissions,
    maintenance, documents, notifications, referralPartners, referralSplits, contractTemplates,
    followUpRules, followUpTasks, branches, teams, ownerPayouts, webhookEndpoints,
    webhookDeliveries, activity,
    settings: {
      id: 'demo-settings',
      organizationId: DEMO_ORG_ID,
      defaultLanguage: 'en',
      defaultCurrency: 'USD',
      data: { companyName: 'EstateOS Demo Realty', taxId: 'DEMO-1234', address: '12 Tahrir Street, Cairo' },
      createdAt: iso(-365),
      updatedAt: iso(-2)
    },
    branding: {
      organizationName: 'EstateOS Demo Realty',
      organizationNameAr: 'عقارات إستيت أو إس التجريبية',
      brandName: 'EstateOS Demo',
      brandNameAr: 'إستيت أو إس التجريبية',
      displayName: 'EstateOS Demo Realty',
      primaryColor: '#4f46e5',
      secondaryColor: '#0f172a',
      accentColor: '#0ea5e9',
      theme: 'INDIGO',
      logoUrl: null,
      faviconUrl: null,
      supportEmail: 'support.demo@estateos.local',
      supportPhone: '+20 100 111 0000',
      footerText: 'Powered by EstateOS Live Demo',
      footerTextAr: 'مدعوم بواسطة العرض التجريبي لإستيت أو إس',
      emailFooter: 'Sent from the EstateOS live demo',
      emailFooterAr: 'مرسل من العرض التجريبي لإستيت أو إس',
      isActive: true
    },
    quotas: {
      plan: 'GROWTH',
      isActive: true,
      usage: { users: users.length, properties: properties.length, deals: deals.length, storageMb: 640 },
      limits: { users: 30, properties: 100, deals: 250, storageMb: 2048 },
      entries: []
    },
    fx: {
      baseCurrency: 'USD',
      currencies: [
        { id: 'demo-fx-usd', code: 'USD', name: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', decimals: 2, isEnabled: true, isBaseCurrency: true, toBaseRate: '1', fromBaseRate: '1', toBaseEffectiveAt: iso(-30), fromBaseEffectiveAt: iso(-30) },
        { id: 'demo-fx-egp', code: 'EGP', name: 'Egyptian Pound', nameAr: 'جنيه مصري', symbol: 'E£', decimals: 2, isEnabled: true, isBaseCurrency: false, toBaseRate: '0.0202', fromBaseRate: '49.5', toBaseEffectiveAt: iso(-30), fromBaseEffectiveAt: iso(-30) },
        { id: 'demo-fx-aed', code: 'AED', name: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'د.إ', decimals: 2, isEnabled: true, isBaseCurrency: false, toBaseRate: '0.2723', fromBaseRate: '3.6725', toBaseEffectiveAt: iso(-30), fromBaseEffectiveAt: iso(-30) },
        { id: 'demo-fx-sar', code: 'SAR', name: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'ر.س', decimals: 2, isEnabled: true, isBaseCurrency: false, toBaseRate: '0.2666', fromBaseRate: '3.75', toBaseEffectiveAt: iso(-30), fromBaseEffectiveAt: iso(-30) },
        { id: 'demo-fx-eur', code: 'EUR', name: 'Euro', nameAr: 'يورو', symbol: '€', decimals: 2, isEnabled: true, isBaseCurrency: false, toBaseRate: '1.08', fromBaseRate: '0.9259', toBaseEffectiveAt: iso(-30), fromBaseEffectiveAt: iso(-30) }
      ],
      rates: [
        { id: 'demo-rate-1', fromCurrency: { code: 'USD' }, toCurrency: { code: 'EGP' }, rate: '49.5', effectiveAt: iso(-30), note: 'Demo rate' },
        { id: 'demo-rate-2', fromCurrency: { code: 'USD' }, toCurrency: { code: 'AED' }, rate: '3.6725', effectiveAt: iso(-30), note: 'Demo rate' },
        { id: 'demo-rate-3', fromCurrency: { code: 'USD' }, toCurrency: { code: 'SAR' }, rate: '3.75', effectiveAt: iso(-30), note: 'Demo rate' }
      ]
    },
    permissions: {
      roles: ['ADMIN', 'MANAGER', 'AGENT', 'ACCOUNTANT', 'TEAM_LEAD'],
      permissions: ['properties.read', 'properties.write', 'finance.read', 'finance.write', 'users.read', 'settings.write'],
      matrix: {
        ADMIN: { 'properties.read': true, 'properties.write': true, 'finance.read': true, 'finance.write': true, 'users.read': true, 'settings.write': true },
        MANAGER: { 'properties.read': true, 'properties.write': true, 'finance.read': true, 'finance.write': true, 'users.read': true, 'settings.write': false },
        AGENT: { 'properties.read': true, 'properties.write': true, 'finance.read': false, 'finance.write': false, 'users.read': false, 'settings.write': false },
        ACCOUNTANT: { 'properties.read': true, 'properties.write': false, 'finance.read': true, 'finance.write': true, 'users.read': false, 'settings.write': false },
        TEAM_LEAD: { 'properties.read': true, 'properties.write': true, 'finance.read': true, 'finance.write': false, 'users.read': true, 'settings.write': false }
      }
    },
    whatsappTemplates: {
      templates: {
        en: {
          propertyShare: 'Hi {{client_name}}, I found a property you may like: {{property_title}} — {{property_price}}.',
          appointmentConfirmation: 'Your viewing at {{property_title}} is confirmed for {{appointment_date}}.',
          appointmentReminder: 'Reminder: your viewing at {{property_title}} is tomorrow.',
          installmentReminder: 'Payment of {{amount}} is due on {{due_date}}.',
          leadFollowUp: 'Hello {{client_name}}, just checking in about your property search.'
        },
        ar: {
          propertyShare: 'مرحباً {{client_name}}، وجدت عقاراً قد يعجبك: {{property_title}} — {{property_price}}.',
          appointmentConfirmation: 'تم تأكيد معاينتك لـ {{property_title}} في {{appointment_date}}.',
          appointmentReminder: 'تذكير: معاينتك لـ {{property_title}} غداً.',
          installmentReminder: 'يستحق دفع {{amount}} بتاريخ {{due_date}}.',
          leadFollowUp: 'مرحباً {{client_name}}، نتابع معك بخصوص بحثك عن عقار.'
        }
      }
    },
    currentUserId: 'demo-user-admin'
  }
}

/** Load (and lazily migrate) the demo database from localStorage. */
export function loadDemoDatabase(): DemoDatabase {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDatabase
      if (parsed && Array.isArray(parsed.properties) && Array.isArray(parsed.users)) {
        // Package 44: enrich demo databases saved before map support without
        // overwriting any edits made during the current demo session.
        const fresh = createDemoDatabase()
        const seeds = new Map(fresh.properties.map((property) => [property.id, property]))
        for (const property of parsed.properties) {
          const seed = seeds.get(property.id)
          if (seed && property.mapX === undefined) {
            for (const field of ['projectName', 'buildingName', 'unitNumber', 'cityArea', 'masterplanImageUrl', 'mapX', 'mapY', 'unitLatitude', 'unitLongitude']) {
              property[field] = seed[field]
            }
          }
        }
        return parsed
      }
    }
  } catch {
    // Corrupt demo state should never break the live demo.
  }
  const fresh = createDemoDatabase()
  saveDemoDatabase(fresh)
  return fresh
}

export function saveDemoDatabase(database: DemoDatabase): void {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(database))
  } catch {
    // Private browsing / quota errors are non-fatal for the current page.
  }
}

export function resetDemoDatabase(): DemoDatabase {
  try {
    localStorage.removeItem(DEMO_STORAGE_KEY)
  } catch {
    // ignore
  }
  return loadDemoDatabase()
}

/** Commission-statement payload derived from the sample rows. */
export function demoCommissionStatements(database: DemoDatabase) {
  return buildCommissionStatements(database.commissions, database.users)
}
