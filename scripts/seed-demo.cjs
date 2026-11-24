require('dotenv/config')
const crypto = require('node:crypto')
const bcrypt = require('bcrypt')
const {
  PrismaClient,
  AccountStatus,
  AppointmentStatus,
  AppointmentType,
  AreaUnit,
  DealStatus,
  DealType,
  ExpenseStatus,
  LeadPriorityTier,
  LeadStatus,
  MaintenancePriority,
  MaintenanceRecurrenceInterval,
  MaintenanceStatus,
  OwnerPayoutStatus,
  PaymentStatus,
  PropertyAttachmentKind,
  PropertyClassification,
  PropertyCondition,
  PropertyStatus,
  PropertyType,
  Role
} = require('@prisma/client')

const prisma = new PrismaClient()
const DAY = 86_400_000
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'EstateDemo2026!'

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function daysFromNow(days, hour = 10) {
  const date = new Date(Date.now() + days * DAY)
  date.setUTCHours(hour, 0, 0, 0)
  return date
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sourceWeight(source) {
  const normalized = String(source || '').trim().toLowerCase()
  if (!normalized) return 0
  if (normalized.includes('referral')) return 18
  if (normalized.includes('website') || normalized === 'web') return 14
  if (normalized.includes('walk')) return 12
  if (normalized.includes('portal')) return 10
  if (normalized.includes('advert') || normalized.includes('campaign')) return 9
  if (normalized.includes('social')) return 8
  return 5
}

function statusWeight(status) {
  return ({ NEW: 14, CONTACTED: 10, QUALIFIED: 8, VIEWING: 7, NEGOTIATION: 6 })[status] || 0
}

function budgetWeight(min, max) {
  const value = Math.max(Number(min) || 0, Number(max) || 0)
  if (!value) return 0
  if (value >= 1_000_000) return 22
  if (value >= 500_000) return 18
  if (value >= 200_000) return 14
  if (value >= 50_000) return 10
  return 6
}

/** Mirrors backend/utils/leadPriority.ts so seeded rows agree with API recomputation. */
function computePriority(lead, now) {
  const created = new Date(lead.createdAt)
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null
  const age = (now.getTime() - created.getTime()) / DAY
  let score = sourceWeight(lead.source) + statusWeight(lead.status) + budgetWeight(lead.budgetMin, lead.budgetMax)
  score += age <= 1 ? 16 : age <= 7 ? 12 : age <= 30 ? 6 : 2
  if (lead.email) score += 4
  if (lead.phone) score += 4
  if (lead.preferredType) score += 3
  if (lead.preferredCity) score += 2
  if (lead.propertyId) score += 3
  if (followUp) {
    const delta = followUp.getTime() - now.getTime()
    score += delta < 0 ? 14 : delta <= DAY ? 10 : 3
  } else if (!lead.lastContactedAt && age > 7) score += 8
  const priorityScore = Math.max(0, Math.min(100, Math.round(score)))
  const priorityTier = priorityScore >= 75 ? LeadPriorityTier.URGENT
    : priorityScore >= 50 ? LeadPriorityTier.HIGH
      : priorityScore >= 25 ? LeadPriorityTier.MEDIUM
        : LeadPriorityTier.LOW
  return { priorityScore, priorityTier }
}

const DEMO_MODELS = [
  'user', 'owner', 'property', 'propertyImage', 'propertyDocument', 'lead', 'leadNote',
  'deal', 'dealClosingChecklist', 'payment', 'expense', 'ownerPayout',
  'appointment', 'maintenanceRequest'
]

async function demoCounts(organizationId) {
  const counts = {}
  for (const model of DEMO_MODELS) {
    const where = { id: { startsWith: 'demo-' } }
    const orgModels = new Set(['user', 'owner', 'property', 'deal', 'ownerPayout', 'maintenanceRequest'])
    if (orgModels.has(model)) where.organizationId = organizationId
    counts[model] = await prisma[model].count({ where })
  }
  return counts
}

async function adminSnapshot(organizationId) {
  const admins = await prisma.user.findMany({
    where: { organizationId, role: Role.ADMIN },
    select: { id: true, email: true, role: true, password: true, isActive: true, deletedAt: true },
    orderBy: { createdAt: 'asc' }
  })
  return digest(admins.map((admin) => ({ ...admin, password: digest(admin.password) })))
}

async function upsertById(model, id, data) {
  return model.upsert({ where: { id }, create: { id, ...data }, update: {} })
}

async function ensureUser(client, organizationId, id, email, role, firstName, password) {
  const existing = await client.user.findFirst({
    where: { OR: [{ id }, { email }] },
    select: { id: true, email: true, role: true, organizationId: true }
  })
  if (existing) return existing
  return client.user.create({
    data: {
      id,
      email,
      password: await bcrypt.hash(password, 10),
      role,
      organizationId,
      firstName,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE
    },
    select: { id: true, email: true, role: true, organizationId: true }
  })
}

async function ensureOwner(client, organizationId, id, email, data) {
  const existing = await client.owner.findFirst({
    where: { OR: [{ id }, { organizationId, email }] },
    select: { id: true }
  })
  if (existing) return existing
  return client.owner.create({ data: { id, organizationId, email, ...data }, select: { id: true } })
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED_ALLOW_PRODUCTION !== '1') {
    throw new Error('Demo seeding is disabled in production. Set DEMO_SEED_ALLOW_PRODUCTION=1 only if intentional.')
  }

  const slug = String(process.env.DEMO_ORG_SLUG || arg('slug', 'estateos')).trim() || 'estateos'
  const organization = await prisma.organization.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, name: true, slug: true, currency: true }
  })
  if (!organization) {
    throw new Error(`Organization '${slug}' was not found. Run the admin setup first; the demo seeder never creates tenants.`)
  }

  const admin = await prisma.user.findFirst({
    where: {
      organizationId: organization.id,
      role: Role.ADMIN,
      deletedAt: null,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' }
  })
  if (!admin) throw new Error(`Organization '${slug}' has no active ADMIN account; no changes were made.`)

  const beforeCounts = await demoCounts(organization.id)
  const beforeAdmin = await adminSnapshot(organization.id)
  const now = new Date()

  const result = await prisma.$transaction(async (tx) => {
    const agent = await ensureUser(tx, organization.id, 'demo-user-agent', 'demo.agent@estateos.local', Role.AGENT, 'Demo Agent', DEMO_PASSWORD)
    const accountant = await ensureUser(tx, organization.id, 'demo-user-accountant', 'demo.accountant@estateos.local', Role.ACCOUNTANT, 'Demo Accountant', DEMO_PASSWORD)

    const ownerSz = await ensureOwner(tx, organization.id, 'demo-owner-sz', 'demo.owner.sz@estateos.local', {
      companyName: 'Sheikh Zayed Holdings / شركة الشيخ زايد القابضة',
      firstName: 'Layla',
      lastName: 'Hassan',
      phone: '+20 100 111 0101',
      city: 'Sheikh Zayed',
      country: 'Egypt',
      notes: 'EN: Prefers bilingual contracts and quarterly statements. AR: تفضّل العقود ثنائية اللغة والكشوفات الفصلية.'
    })
    const ownerOctober = await ensureOwner(tx, organization.id, 'demo-owner-october', 'demo.owner.6oct@estateos.local', {
      companyName: '6th October Property Partners / شركاء عقارات السادس من أكتوبر',
      firstName: 'Omar',
      lastName: 'Saleh',
      phone: '+20 100 222 0202',
      city: '6th of October',
      country: 'Egypt',
      notes: 'EN: Rentals and family villas portfolio. AR: محفظة إيجارات وفلل عائلية.'
    })

    const properties = [
      {
        id: 'demo-property-sz-001',
        referenceNumber: 'DEMO-SZ-001',
        title: 'Skyline Residence — مسكن أفق السادس',
        description: 'EN: Bright 3-bedroom apartment with a private terrace in Sheikh Zayed. AR: شقة مضيئة بثلاث غرف نوم وشرفة خاصة في الشيخ زايد.',
        type: PropertyType.APARTMENT,
        status: PropertyStatus.AVAILABLE,
        classification: PropertyClassification.SALE,
        address: '12 Nile Street, Compound 778',
        city: 'Sheikh Zayed',
        state: 'Giza',
        country: 'Egypt',
        latitude: 30.0197,
        longitude: 31.0089,
        area: 168,
        areaUnit: AreaUnit.SQ_M,
        bedrooms: 3,
        bathrooms: 2,
        floors: 1,
        yearBuilt: 2022,
        condition: PropertyCondition.EXCELLENT,
        price: 4_850_000,
        currency: 'EGP',
        negotiable: true,
        featured: true,
        publicShareToken: 'demo-share-sz-001',
        publicShareEnabled: true,
        ownerId: ownerSz.id,
        assignedAgentId: agent.id,
        gallery: ['Living room / غرفة المعيشة', 'Terrace / الشرفة', 'Kitchen / المطبخ'],
        documents: [
          { suffix: 'floorplan', kind: PropertyAttachmentKind.FLOORPLAN, name: 'Floor plan A / مخطط A' },
          { suffix: 'brochure', kind: PropertyAttachmentKind.BROCHURE, name: 'Brochure EN-AR / كتيّب عربي-إنجليزي' }
        ]
      },
      {
        id: 'demo-property-sz-002',
        referenceNumber: 'DEMO-SZ-002',
        title: 'Garden Townhouse — تاون هاوس الحديقة',
        description: 'EN: Family townhouse with landscaped garden and dual reception. AR: تاون هاوس عائلي بحديقة ومنطقتَي استقبال.',
        type: PropertyType.TOWNHOUSE,
        status: PropertyStatus.PENDING,
        classification: PropertyClassification.SALE,
        address: '41 Palm Valley, Sheikh Zayed',
        city: 'Sheikh Zayed',
        state: 'Giza',
        country: 'Egypt',
        latitude: 30.0102,
        longitude: 31.0174,
        area: 245,
        areaUnit: AreaUnit.SQ_M,
        bedrooms: 4,
        bathrooms: 3,
        floors: 2,
        yearBuilt: 2020,
        condition: PropertyCondition.GOOD,
        price: 7_200_000,
        currency: 'EGP',
        featured: true,
        publicShareToken: 'demo-share-sz-002',
        publicShareEnabled: true,
        ownerId: ownerSz.id,
        assignedAgentId: agent.id,
        gallery: ['Garden / الحديقة', 'Reception / الاستقبال', 'Master bedroom / غرفة النوم الرئيسية'],
        documents: [
          { suffix: 'floorplan', kind: PropertyAttachmentKind.FLOORPLAN, name: 'Ground floor / الدور الأرضي' },
          { suffix: 'brochure', kind: PropertyAttachmentKind.BROCHURE, name: 'Portfolio brochure / كتيّب المحفظة' }
        ]
      },
      {
        id: 'demo-property-oct-001',
        referenceNumber: 'DEMO-6OCT-001',
        title: 'November Business Suite — جناح الأعمال نوفمبر',
        description: 'EN: Furnished 82 sqm office suite near the November 6th axis. AR: جناح مكتبي مفروش بمساحة 82 مترًا قرب محور 6 نوفمبر.',
        type: PropertyType.COMMERCIAL,
        status: PropertyStatus.AVAILABLE,
        classification: PropertyClassification.RENT,
        address: '8 Business Hub, 6th of October',
        city: '6th of October',
        state: 'Giza',
        country: 'Egypt',
        latitude: 29.9336,
        longitude: 31.0925,
        area: 82,
        areaUnit: AreaUnit.SQ_M,
        bedrooms: 0,
        bathrooms: 2,
        yearBuilt: 2023,
        condition: PropertyCondition.NEW,
        price: 95_000,
        currency: 'EGP',
        publicShareToken: 'demo-share-6oct-001',
        publicShareEnabled: true,
        ownerId: ownerOctober.id,
        assignedAgentId: agent.id,
        gallery: ['Reception / الاستقبال', 'Meeting room / قوة الاجتماعات', 'Pantry / المطبخ الصغير'],
        documents: [
          { suffix: 'floorplan', kind: PropertyAttachmentKind.FLOORPLAN, name: 'Office layout / مخطط المكتب' },
          { suffix: 'brochure', kind: PropertyAttachmentKind.BROCHURE, name: 'Leasing pack / حزمة الإيجار' }
        ]
      },
      {
        id: 'demo-property-oct-002',
        referenceNumber: 'DEMO-6OCT-002',
        title: 'October Family Villa — فيلا أكتوبر العائلية',
        description: 'EN: Five-bedroom villa with pool and maid quarters. AR: فيلا بخمس غرف نوم ومسبح وغرفة خادمة.',
        type: PropertyType.VILLA,
        status: PropertyStatus.RESERVED,
        classification: PropertyClassification.SALE,
        address: '19 Green Garden, 6th of October',
        city: '6th of October',
        state: 'Giza',
        country: 'Egypt',
        latitude: 29.9108,
        longitude: 31.0798,
        area: 410,
        areaUnit: AreaUnit.SQ_M,
        bedrooms: 5,
        bathrooms: 4,
        floors: 2,
        yearBuilt: 2021,
        condition: PropertyCondition.EXCELLENT,
        price: 9_600_000,
        currency: 'EGP',
        negotiable: true,
        publicShareToken: 'demo-share-6oct-002',
        publicShareEnabled: true,
        ownerId: ownerOctober.id,
        assignedAgentId: agent.id,
        gallery: ['Facade / الواجهة', 'Pool / المسبح', 'Dining / غرفة الطعام'],
        documents: [
          { suffix: 'floorplan', kind: PropertyAttachmentKind.FLOORPLAN, name: 'Villa master plan / مخطط الفيلا' },
          { suffix: 'brochure', kind: PropertyAttachmentKind.BROCHURE, name: 'Villa brochure / كتيّب الفيلا' }
        ]
      }
    ]

    for (const property of properties) {
      const { gallery, documents, ...data } = property
      await upsertById(tx.property, property.id, { organizationId: organization.id, ...data })

      for (const [index, caption] of gallery.entries()) {
        await upsertById(tx.propertyImage, `${property.id}-img-${index + 1}`, {
          propertyId: property.id,
          url: `/demo/gallery/${property.referenceNumber}-${index + 1}.jpg`,
          storageKey: `demo/gallery/${property.referenceNumber}-${index + 1}.jpg`,
          originalName: `${property.referenceNumber}-${index + 1}.jpg`,
          mimeType: 'image/jpeg',
          size: 240_000 + index * 18_000,
          caption,
          isPrimary: index === 0,
          sortOrder: index,
          uploadedById: agent.id
        })
      }

      for (const [index, document] of documents.entries()) {
        await upsertById(tx.propertyDocument, `${property.id}-doc-${document.suffix}`, {
          propertyId: property.id,
          name: document.name,
          url: `/demo/documents/${property.referenceNumber}-${document.suffix}.pdf`,
          storageKey: `demo/documents/${property.referenceNumber}-${document.suffix}.pdf`,
          originalName: `${property.referenceNumber}-${document.suffix}.pdf`,
          mimeType: 'application/pdf',
          kind: document.kind,
          size: 128_000 + index * 12_000,
          sortOrder: index
        })
      }
    }

    const propertyIds = properties.map((property) => property.id)
    const leadSpecs = [
      {
        id: 'demo-lead-urgent', firstName: 'Nour', lastName: 'Farouk', source: 'Referral',
        status: LeadStatus.NEW, budgetMin: 1_200_000, budgetMax: 1_600_000,
        email: 'nour.demo@example.invalid', phone: '+20 100 333 0303',
        preferredType: PropertyType.APARTMENT, preferredCity: 'Sheikh Zayed',
        preferredBedrooms: 3, propertyId: propertyIds[0], createdAt: daysFromNow(-1),
        nextFollowUpAt: daysFromNow(-1), notes: 'EN: Urgent referral, ready to view today. AR: إحالة عاجلة، مستعدة للمعاينة اليوم.'
      },
      {
        id: 'demo-lead-high', firstName: 'Karim', lastName: 'Nabil', source: 'Website',
        status: LeadStatus.CONTACTED, budgetMin: 650_000, budgetMax: 800_000,
        email: 'karim.demo@example.invalid', phone: '+20 100 444 0404',
        preferredType: PropertyType.TOWNHOUSE, preferredCity: 'Sheikh Zayed',
        preferredBedrooms: 4, propertyId: propertyIds[1], createdAt: daysFromNow(-4),
        nextFollowUpAt: daysFromNow(0), lastContactedAt: daysFromNow(-2),
        notes: 'EN: Website lead; prefers gardens. AR: عميل من الموقع، يفضل الحدائق.'
      },
      {
        id: 'demo-lead-medium', firstName: 'Sara', lastName: 'Adel', source: 'Facebook Social',
        status: LeadStatus.QUALIFIED, budgetMin: 250_000, budgetMax: 320_000,
        email: 'sara.demo@example.invalid', phone: '+20 100 555 0505',
        preferredType: PropertyType.COMMERCIAL, preferredCity: '6th of October',
        propertyId: propertyIds[2], createdAt: daysFromNow(-12),
        nextFollowUpAt: daysFromNow(5), lastContactedAt: daysFromNow(-3),
        notes: 'EN: Looking for a small office. AR: تبحث عن مكتب صغير.'
      },
      {
        id: 'demo-lead-portal', firstName: 'Tarek', lastName: 'Moussa', source: 'Property Portal',
        status: LeadStatus.VIEWING, budgetMin: 80_000, budgetMax: 110_000,
        email: 'tarek.demo@example.invalid', phone: '+20 100 666 0606',
        preferredType: PropertyType.COMMERCIAL, preferredCity: '6th of October',
        createdAt: daysFromNow(-45), lastContactedAt: daysFromNow(-6),
        notes: 'EN: Portal enquiry, viewing completed. AR: استفسار من البوابة، تمت المعاينة.'
      },
      {
        id: 'demo-lead-low', firstName: 'Mona', lastName: 'Raafat', source: 'Unknown',
        status: LeadStatus.LOST, phone: '+20 100 777 0707',
        preferredCity: '6th of October', createdAt: daysFromNow(-80),
        notes: 'EN: Archived enquiry, no current budget. AR: استفسار مؤرشف، لا توجد ميزانية حالية.'
      }
    ]

    for (const spec of leadSpecs) {
      const priority = computePriority(spec, now)
      await upsertById(tx.lead, spec.id, {
        ...spec,
        priorityScore: priority.priorityScore,
        priorityTier: priority.priorityTier,
        assignedToId: agent.id,
        isActive: true
      })
      await upsertById(tx.leadNote, `${spec.id}-note`, {
        leadId: spec.id,
        authorId: agent.id,
        body: `EN: ${spec.notes.split('AR:')[0].trim()} AR: ${spec.notes.split('AR:')[1]?.trim() || ''}`,
        nextFollowUpAt: spec.nextFollowUpAt || null
      })
    }

    const dealSpecs = [
      {
        id: 'demo-deal-sz-sale', referenceNumber: 'DEMO-DEAL-SZ-SALE',
        propertyId: propertyIds[0], leadId: 'demo-lead-urgent', type: DealType.SALE,
        status: DealStatus.ACTIVE, amount: 4_720_000, currency: 'EGP',
        startedAt: daysFromNow(-20), dueAt: daysFromNow(25),
        notes: 'EN: Active sale with bilingual contract. AR: بيع نشط بعقد ثنائي اللغة.'
      },
      {
        id: 'demo-deal-sz-townhouse', referenceNumber: 'DEMO-DEAL-SZ-TOWNHOUSE',
        propertyId: propertyIds[1], leadId: 'demo-lead-high', type: DealType.SALE,
        status: DealStatus.ACTIVE, amount: 7_050_000, currency: 'EGP',
        startedAt: daysFromNow(-12), dueAt: daysFromNow(40),
        notes: 'EN: Townhouse reservation pending bank transfer. AR: حجز تاون هاوس بانتظار التحويل البنكي.'
      },
      {
        id: 'demo-deal-oct-rent', referenceNumber: 'DEMO-DEAL-OCT-RENT',
        propertyId: propertyIds[2], leadId: 'demo-lead-medium', type: DealType.RENT,
        status: DealStatus.ACTIVE, amount: 1_140_000, currency: 'EGP',
        startedAt: daysFromNow(-70), dueAt: daysFromNow(45),
        leaseStartAt: daysFromNow(-60), leaseEndAt: daysFromNow(305), renewalNoticeDays: 45,
        notes: 'EN: Annual office lease with quarterly installments. AR: إيجار مكتبي سنوي بدفعات ربع سنوية.'
      }
    ]

    const checklistItems = [
      ['PAYMENT_SETTLED', 'Payment settled / تسوية الدفعة'],
      ['DOCUMENTS_COMPLETE', 'Documents complete / اكتمال المستندات'],
      ['CONTRACT_SIGNED', 'Contract signed / توقيع العقد'],
      ['HANDOVER_CONFIRMED', 'Handover confirmed / تأكيد الاستلام']
    ]

    for (const deal of dealSpecs) {
      await upsertById(tx.deal, deal.id, {
        ...deal,
        organizationId: organization.id,
        userId: agent.id,
        isActive: true
      })

      for (const [index, [itemKey, label]] of checklistItems.entries()) {
        const completed = index < (deal.id === 'demo-deal-oct-rent' ? 4 : 2)
        await upsertById(tx.dealClosingChecklist, `${deal.id}-check-${itemKey}`, {
          dealId: deal.id,
          organizationId: organization.id,
          itemKey,
          label,
          isCompleted: completed,
          completedAt: completed ? daysFromNow(-3) : null,
          completedById: completed ? agent.id : null
        })
      }

      const installmentPlan = [
        { reference: 'INSTALL-1', amount: deal.amount * 0.2, status: PaymentStatus.COMPLETED, dueOffset: -95, paidOffset: -92 },
        { reference: 'INSTALL-2', amount: deal.amount * 0.2, status: PaymentStatus.PENDING, dueOffset: -75 },
        { reference: 'INSTALL-3', amount: deal.amount * 0.2, status: PaymentStatus.PENDING, dueOffset: -45 },
        { reference: 'INSTALL-4', amount: deal.amount * 0.2, status: PaymentStatus.PENDING, dueOffset: -12 },
        { reference: 'INSTALL-5', amount: deal.amount * 0.2, status: PaymentStatus.PENDING, dueOffset: 20 }
      ]

      for (const installment of installmentPlan) {
        await upsertById(tx.payment, `${deal.id}-${installment.reference.toLowerCase()}`, {
          dealId: deal.id,
          amount: installment.amount,
          currency: deal.currency,
          status: installment.status,
          method: 'Bank Transfer / تحويل بنكي',
          reference: installment.reference,
          notes: 'EN: Demo installment across aging buckets. AR: دفعة تجريبية عبر فئات التأخر.',
          idempotencyKey: `demo-${deal.id}-${installment.reference}`,
          baseAmount: installment.amount,
          dueAt: daysFromNow(installment.dueOffset),
          paidAt: installment.paidOffset === undefined ? null : daysFromNow(installment.paidOffset),
          createdById: accountant.id
        })
      }
    }

    const expenseSpecs = [
      { id: 'demo-expense-sz-001', propertyId: propertyIds[0], dealId: dealSpecs[0].id, category: 'MAINTENANCE', amount: 3_800, description: 'EN: Lobby repaint. AR: إعادة طلاء اللوبي.' },
      { id: 'demo-expense-sz-002', propertyId: propertyIds[1], dealId: dealSpecs[1].id, category: 'LEGAL', amount: 6_200, description: 'EN: Contract review. AR: مراجعة العقد.' },
      { id: 'demo-expense-oct-001', propertyId: propertyIds[2], dealId: dealSpecs[2].id, category: 'UTILITIES', amount: 1_450, description: 'EN: Office utilities. AR: مرافق المكتب.' }
    ]
    for (const expense of expenseSpecs) {
      await upsertById(tx.expense, expense.id, {
        ...expense,
        responsibleId: accountant.id,
        currency: 'EGP',
        status: ExpenseStatus.PAID,
        spentAt: daysFromNow(-10),
        paidAt: daysFromNow(-8)
      })
    }

    const payoutSpecs = [
      { id: 'demo-payout-sz-pending', ownerId: ownerSz.id, amount: 42_500, status: OwnerPayoutStatus.PENDING, reference: 'DEMO-PAYOUT-SZ-PENDING' },
      { id: 'demo-payout-sz-settled', ownerId: ownerSz.id, amount: 38_000, status: OwnerPayoutStatus.SETTLED, reference: 'DEMO-PAYOUT-SZ-SETTLED' },
      { id: 'demo-payout-oct-pending', ownerId: ownerOctober.id, amount: 51_250, status: OwnerPayoutStatus.PENDING, reference: 'DEMO-PAYOUT-OCT-PENDING' }
    ]
    for (const payout of payoutSpecs) {
      await upsertById(tx.ownerPayout, payout.id, {
        ...payout,
        organizationId: organization.id,
        currency: 'EGP',
        notes: 'EN: Demo owner settlement. AR: تسوية تجريبية للمالك.',
        periodStart: daysFromNow(-90),
        periodEnd: daysFromNow(-1),
        createdById: accountant.id,
        settledAt: payout.status === OwnerPayoutStatus.SETTLED ? daysFromNow(-2) : null,
        settledById: payout.status === OwnerPayoutStatus.SETTLED ? accountant.id : null
      })
    }

    const appointmentSpecs = [
      { id: 'demo-appointment-sz-viewing', propertyId: propertyIds[0], leadId: 'demo-lead-urgent', title: 'Skyline viewing / معاينة أفق السادس', type: AppointmentType.VIEWING, offset: 1 },
      { id: 'demo-appointment-sz-meeting', propertyId: propertyIds[1], leadId: 'demo-lead-high', title: 'Townhouse negotiation / تفاوض التاون هاوس', type: AppointmentType.MEETING, offset: 3 },
      { id: 'demo-appointment-oct-call', propertyId: propertyIds[2], leadId: 'demo-lead-medium', title: 'Lease terms call / مكالمة شروط الإيجار', type: AppointmentType.CALL, offset: 2 },
      { id: 'demo-appointment-oct-viewing', propertyId: propertyIds[3], leadId: null, title: 'Villa inspection / فحص الفيلا', type: AppointmentType.VIEWING, offset: 5 }
    ]
    for (const appointment of appointmentSpecs) {
      const startsAt = daysFromNow(appointment.offset, 11)
      await upsertById(tx.appointment, appointment.id, {
        id: appointment.id,
        propertyId: appointment.propertyId,
        leadId: appointment.leadId,
        title: appointment.title,
        type: appointment.type,
        status: AppointmentStatus.SCHEDULED,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        notes: 'EN: Bilingual demo appointment. AR: موعد تجريبي ثنائي اللغة.',
        userId: agent.id
      })
    }

    const maintenanceSpecs = [
      {
        id: 'demo-maintenance-sz-monthly', propertyId: propertyIds[0],
        title: 'Monthly HVAC service / صيانة التكييف الشهرية',
        description: 'EN: Recurring filter replacement and coil check. AR: استبدال الفلاتر وفحص الملفات بشكل متكرر.',
        priority: MaintenancePriority.MEDIUM, status: MaintenanceStatus.OPEN,
        interval: MaintenanceRecurrenceInterval.MONTHLY, dueOffset: 14
      },
      {
        id: 'demo-maintenance-oct-quarterly', propertyId: propertyIds[2],
        title: 'Quarterly fire-alarm test / اختبار إنذار الحريق الفصلي',
        description: 'EN: Annual contract requires quarterly inspection. AR: يتطلب العقد السنوي فحصًا فصليًا.',
        priority: MaintenancePriority.HIGH, status: MaintenanceStatus.IN_PROGRESS,
        interval: MaintenanceRecurrenceInterval.QUARTERLY, dueOffset: 21
      },
      {
        id: 'demo-maintenance-oct-semiannual', propertyId: propertyIds[3],
        title: 'Semi-annual pool inspection / فحص المسبح نصف السنوي',
        description: 'EN: Structural and pump inspection twice per year. AR: فحص إنشائي ومضخات مرتين سنويًا.',
        priority: MaintenancePriority.LOW, status: MaintenanceStatus.OPEN,
        interval: MaintenanceRecurrenceInterval.SEMI_ANNUAL, dueOffset: 35
      }
    ]
    for (const request of maintenanceSpecs) {
      const dueAt = daysFromNow(request.dueOffset, 9)
      await upsertById(tx.maintenanceRequest, request.id, {
        id: request.id,
        organizationId: organization.id,
        propertyId: request.propertyId,
        title: request.title,
        description: request.description,
        priority: request.priority,
        status: request.status,
        assignedToId: agent.id,
        createdById: agent.id,
        currency: 'EGP',
        dueAt,
        nextDueAt: dueAt,
        recurrenceInterval: request.interval,
        notes: 'EN: Recurring demo maintenance. AR: صيانة تجريبية متكررة.'
      })
    }

    return { agent, accountant, admin }
  })

  const afterCounts = await demoCounts(organization.id)
  const afterAdmin = await adminSnapshot(organization.id)
  if (beforeAdmin !== afterAdmin) {
    throw new Error('Existing ADMIN accounts changed during demo seeding; investigate before continuing.')
  }

  const created = {}
  for (const model of DEMO_MODELS) created[model] = afterCounts[model] - beforeCounts[model]

  const summary = {
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    admin: { id: result.admin.id, email: result.admin.email, unchanged: true },
    demoUsers: [result.agent, result.accountant].map((user) => ({ id: user.id, email: user.email, role: user.role })),
    counts: { before: beforeCounts, after: afterCounts, created },
    adminFingerprint: afterAdmin
  }

  if (process.env.DEMO_SEED_JSON === '1') {
    console.log(JSON.stringify(summary))
  } else {
    console.log(`Demo seed complete for ${organization.name} (${organization.slug}).`)
    console.log(`Existing ADMIN accounts unchanged: ${result.admin.email}`)
    console.log('Demo accounts use DEMO_SEED_PASSWORD (default: EstateDemo2026!).')
    console.log(`Seeded demo rows: ${DEMO_MODELS.map((model) => `${model}=${afterCounts[model]}`).join(', ')}`)
    console.log(`DEMO_SEED_SUMMARY=${JSON.stringify(summary)}`)
  }
}

main()
  .catch((error) => {
    console.error(`Demo seed failed: ${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
