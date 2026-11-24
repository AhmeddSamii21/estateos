const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
require('dotenv/config')

const { PrismaClient, Role } = require('@prisma/client')
const prisma = new PrismaClient()

const projectRoot = path.resolve(__dirname, '..')
const seedScript = path.join(projectRoot, 'scripts', 'seed-demo.cjs')
const orgSlug = process.env.DEMO_ORG_SLUG || 'estateos'

const DEMO_MODELS = [
  'user', 'owner', 'property', 'propertyImage', 'propertyDocument', 'lead', 'leadNote',
  'deal', 'dealClosingChecklist', 'payment', 'expense', 'ownerPayout',
  'appointment', 'maintenanceRequest', 'branch', 'team',
  // Package 43 extends the same idempotent demo seed with packages 33-42 rows.
  'notification', 'referralPartner', 'referralSplit', 'contractTemplate',
  'organizationBranding', 'planQuota', 'followUpRule', 'followUpTask'
]
const ORG_SCOPED_DEMO_MODELS = new Set([
  'user', 'owner', 'property', 'deal', 'ownerPayout', 'maintenanceRequest', 'branch', 'team',
  'notification', 'referralPartner', 'referralSplit', 'contractTemplate',
  'organizationBranding', 'planQuota', 'followUpRule', 'followUpTask'
])

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function adminFingerprint(organizationId) {
  const admins = await prisma.user.findMany({
    where: { organizationId, role: Role.ADMIN },
    select: { id: true, email: true, role: true, password: true, isActive: true, deletedAt: true },
    orderBy: { createdAt: 'asc' }
  })
  return digest(admins.map((admin) => ({ ...admin, password: digest(admin.password) })))
}

async function demoCounts(organizationId) {
  const counts = {}
  for (const model of DEMO_MODELS) {
    const where = { id: { startsWith: 'demo-' } }
    if (ORG_SCOPED_DEMO_MODELS.has(model)) where.organizationId = organizationId
    counts[model] = await prisma[model].count({ where })
  }
  return counts
}

function runSeed() {
  const output = execFileSync(process.execPath, [seedScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DEMO_ORG_SLUG: orgSlug,
      DEMO_SEED_JSON: '1'
    },
    timeout: 120_000
  })
  return JSON.parse(output.trim().split(/\r?\n/).pop())
}

test.after(async () => {
  await prisma.$disconnect()
})

test('Package 24: demo seeding is idempotent and preserves existing ADMIN accounts', async () => {
  const organization = await prisma.organization.findFirst({
    where: { slug: orgSlug, deletedAt: null },
    select: { id: true }
  })
  assert.ok(organization, `Organization '${orgSlug}' must exist before demo seeding`)

  const beforeAdmins = await adminFingerprint(organization.id)
  const beforeCounts = await demoCounts(organization.id)

  const first = runSeed()
  const afterFirst = await demoCounts(organization.id)
  const afterFirstAdmins = await adminFingerprint(organization.id)

  const second = runSeed()
  const afterSecond = await demoCounts(organization.id)
  const afterSecondAdmins = await adminFingerprint(organization.id)

  assert.equal(first.organization.id, organization.id)
  assert.equal(second.organization.id, organization.id)
  assert.deepEqual(afterFirst, afterSecond)
  assert.deepEqual(second.counts.before, afterFirst)
  assert.deepEqual(second.counts.after, afterSecond)
  assert.deepEqual(second.counts.created, Object.fromEntries(DEMO_MODELS.map((model) => [model, 0])))
  assert.equal(beforeAdmins, afterFirstAdmins)
  assert.equal(afterFirstAdmins, afterSecondAdmins)
  assert.equal(first.admin.unchanged, true)
  assert.equal(second.admin.unchanged, true)

  assert.equal(afterSecond.property, 4)
  assert.equal(afterSecond.propertyImage, 12)
  assert.equal(afterSecond.propertyDocument, 8)
  assert.equal(afterSecond.lead, 5)
  assert.equal(afterSecond.leadNote, 5)
  assert.equal(afterSecond.deal, 3)
  assert.equal(afterSecond.dealClosingChecklist, 12)
  assert.equal(afterSecond.payment, 15)
  assert.equal(afterSecond.expense, 3)
  assert.equal(afterSecond.owner, 2)
  assert.equal(afterSecond.ownerPayout, 3)
  assert.equal(afterSecond.appointment, 4)
  assert.equal(afterSecond.maintenanceRequest, 3)
  assert.equal(afterSecond.user, 3)
  assert.equal(afterSecond.branch, 1)
  assert.equal(afterSecond.team, 1)

  for (const model of DEMO_MODELS) {
    assert.ok(afterSecond[model] >= beforeCounts[model], `${model} must never be removed`)
  }
})

test('Package 24: seeded records are bilingual and cover the walkthrough scenarios', async () => {
  const organization = await prisma.organization.findFirst({
    where: { slug: orgSlug, deletedAt: null },
    select: { id: true }
  })
  assert.ok(organization)

  const properties = await prisma.property.findMany({
    where: { id: { startsWith: 'demo-property-' }, organizationId: organization.id },
    include: { images: true, documents: true },
    orderBy: { referenceNumber: 'asc' }
  })
  assert.equal(properties.length, 4)
  assert.ok(properties.every((property) => /[\u0600-\u06FF]/.test(property.title)))
  assert.ok(properties.every((property) => property.description.includes('AR:')))
  assert.deepEqual([...new Set(properties.map((property) => property.city))].sort(), ['6th of October', 'Sheikh Zayed'])
  assert.ok(properties.every((property) => property.images.length === 3 && property.documents.length === 2))
  assert.ok(properties.some((property) => property.documents.some((doc) => doc.kind === 'FLOORPLAN')))
  assert.ok(properties.some((property) => property.documents.some((doc) => doc.kind === 'BROCHURE')))

  const leads = await prisma.lead.findMany({
    where: { id: { startsWith: 'demo-lead-' } },
    select: { source: true, priorityTier: true, priorityScore: true }
  })
  assert.equal(leads.length, 5)
  assert.ok(new Set(leads.map((lead) => lead.source)).size >= 5)
  assert.ok(leads.every((lead) => lead.priorityScore > 0 && lead.priorityScore <= 100))
  assert.ok(leads.some((lead) => lead.priorityTier === 'URGENT'))
  assert.ok(leads.some((lead) => lead.priorityTier === 'LOW'))

  const buckets = await prisma.payment.findMany({
    where: { id: { startsWith: 'demo-deal-' } },
    select: { status: true, dueAt: true }
  })
  const now = Date.now()
  const aging = new Set(buckets.map((payment) => {
    if (payment.status === 'COMPLETED') return 'PAID'
    if (!payment.dueAt || payment.dueAt.getTime() >= now) return 'CURRENT'
    const days = (now - payment.dueAt.getTime()) / 86_400_000
    return days <= 30 ? '1_30_DAYS' : days <= 60 ? '31_60_DAYS' : '60_PLUS_DAYS'
  }))
  assert.deepEqual([...aging].sort(), ['1_30_DAYS', '31_60_DAYS', '60_PLUS_DAYS', 'CURRENT', 'PAID'])

  const checklists = await prisma.dealClosingChecklist.count({ where: { id: { startsWith: 'demo-deal-' } } })
  assert.equal(checklists, 12)

  const recurrence = await prisma.maintenanceRequest.findMany({
    where: { id: { startsWith: 'demo-maintenance-' } },
    select: { recurrenceInterval: true, nextDueAt: true }
  })
  assert.deepEqual(
    [...new Set(recurrence.map((row) => row.recurrenceInterval))].sort(),
    ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL']
  )
  assert.ok(recurrence.every((row) => row.nextDueAt))

  const appointments = await prisma.appointment.count({ where: { id: { startsWith: 'demo-appointment-' }, status: 'SCHEDULED' } })
  assert.equal(appointments, 4)

  const branch = await prisma.branch.findUnique({
    where: { id: 'demo-branch-main' },
    select: { id: true, organizationId: true, nameAr: true }
  })
  const team = await prisma.team.findUnique({
    where: { id: 'demo-team-sales' },
    select: { id: true, organizationId: true, branchId: true, nameAr: true, leaderId: true }
  })
  const hierarchyUsers = await prisma.user.findMany({
    where: { id: { startsWith: 'demo-user-' } },
    select: { id: true, role: true, branchId: true, teamId: true }
  })
  const teamLead = hierarchyUsers.find((user) => user.id === 'demo-user-team-lead')
  assert.equal(branch.organizationId, organization.id)
  assert.match(branch.nameAr, /[\u0600-\u06FF]/)
  assert.equal(team.organizationId, organization.id)
  assert.equal(team.branchId, branch.id)
  assert.match(team.nameAr, /[\u0600-\u06FF]/)
  assert.equal(team.leaderId, teamLead?.id)
  assert.equal(teamLead?.role, Role.TEAM_LEAD)
  assert.equal(teamLead?.branchId, branch.id)
  assert.equal(teamLead?.teamId, team.id)

  const groupedCounts = {
    property: await prisma.property.count({ where: { id: { startsWith: 'demo-property-' }, organizationId: organization.id, branchId: branch.id, teamId: team.id } }),
    lead: await prisma.lead.count({ where: { id: { startsWith: 'demo-lead-' }, branchId: branch.id, teamId: team.id } }),
    deal: await prisma.deal.count({ where: { id: { startsWith: 'demo-deal-' }, organizationId: organization.id, branchId: branch.id, teamId: team.id } })
  }
  assert.deepEqual(groupedCounts, { property: 4, lead: 5, deal: 3 })
})

test('Package 43: demo seed covers packages 33-42 with bilingual, tenant-owned records', async () => {
  const organization = await prisma.organization.findFirst({
    where: { slug: orgSlug, deletedAt: null },
    select: { id: true }
  })
  assert.ok(organization)

  const [properties, notifications, partners, splits, templates, branding, planQuota, rules, tasks] = await Promise.all([
    prisma.property.findMany({
      where: { id: { startsWith: 'demo-property-' }, organizationId: organization.id },
      select: { features: true, paymentTerms: true, projectName: true, buildingName: true, unitNumber: true }
    }),
    prisma.notification.findMany({ where: { id: { startsWith: 'demo-notification-' }, organizationId: organization.id } }),
    prisma.referralPartner.findMany({ where: { id: { startsWith: 'demo-referral-' }, organizationId: organization.id } }),
    prisma.referralSplit.findMany({ where: { id: { startsWith: 'demo-referral-split-' }, organizationId: organization.id } }),
    prisma.contractTemplate.findMany({ where: { id: { startsWith: 'demo-contract-' }, organizationId: organization.id } }),
    prisma.organizationBranding.findMany({ where: { id: { startsWith: 'demo-branding-' }, organizationId: organization.id } }),
    prisma.planQuota.findMany({ where: { id: { startsWith: 'demo-plan-' }, organizationId: organization.id } }),
    prisma.followUpRule.findMany({ where: { id: { startsWith: 'demo-followup-rule-' }, organizationId: organization.id } }),
    prisma.followUpTask.findMany({ where: { id: { startsWith: 'demo-followup-task-' }, organizationId: organization.id } })
  ])

  assert.equal(properties.length, 4)
  assert.ok(properties.every((property) => property.features && property.paymentTerms && property.projectName && property.buildingName && property.unitNumber))
  assert.equal(notifications.length, 3)
  assert.ok(notifications.every((row) => /[\u0600-\u06FF]/.test(row.title)))
  assert.equal(partners.length, 1)
  assert.match(partners[0].nameAr, /[\u0600-\u06FF]/)
  assert.equal(splits.length, 1)
  assert.equal(Number(splits[0].rate), 7.5)
  assert.equal(templates.length, 1)
  assert.match(templates[0].bodyAr, /[\u0600-\u06FF]/)
  assert.match(templates[0].bodyAr, /\{\{deal_reference\}\}/)
  assert.equal(branding.length, 1)
  assert.equal(branding[0].organizationId, organization.id)
  assert.equal(planQuota.length, 1)
  assert.equal(planQuota[0].plan, 'GROWTH')
  assert.equal(rules.length, 2)
  assert.deepEqual([...new Set(rules.map((rule) => rule.trigger))].sort(), ['DEAL_STALLED', 'NEW_LEAD'])
  assert.equal(tasks.length, 2)
  assert.ok(tasks.every((task) => task.sourceKey && task.userId))
})
