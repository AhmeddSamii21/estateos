/*
 * Temporary fixture for real browser verification.
 *
 * create   - creates a uniquely named organization, ADMIN, property, lead and deal.
 *            The generated password is written only to a local temp metadata file.
 * cleanup  - removes only the records created by the matching `create` run.
 *
 * No credentials are printed.
 */
require('dotenv/config')

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const metadataPath = path.join(os.tmpdir(), 'opencode', 'estateos-browser-fixture.json')

async function create() {
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const tag = `IBROWSE-${runId}`
  const password = `Browse!${crypto.randomBytes(18).toString('base64url')}`

  const organization = await prisma.organization.create({
    data: {
      name: `${tag} Organization`,
      slug: tag.toLowerCase(),
      currency: 'USD',
      baseCurrency: 'USD'
    },
    select: { id: true }
  })

  const user = await prisma.user.create({
    data: {
      email: `${tag.toLowerCase()}-admin@example.invalid`,
      password: await bcrypt.hash(password, 10),
      role: 'ADMIN',
      organizationId: organization.id,
      firstName: `${tag} Admin`,
      isActive: true
    },
    select: { id: true, email: true }
  })

  const property = await prisma.property.create({
    data: {
      referenceNumber: `${tag}-P1`,
      title: `${tag} Browser Property`,
      description: `${tag} browser verification fixture`,
      type: 'HOUSE',
      status: 'AVAILABLE',
      classification: 'SALE',
      city: 'BrowserCity',
      country: 'Testland',
      latitude: 40.7128,
      longitude: -74.006,
      area: 180,
      bedrooms: 3,
      bathrooms: 2,
      price: 325000,
      currency: 'USD',
      organizationId: organization.id,
      assignedAgentId: user.id
    },
    select: { id: true }
  })

  const lead = await prisma.lead.create({
    data: {
      firstName: `${tag} Lead`,
      lastName: 'Browser',
      email: `${tag.toLowerCase()}-lead@example.invalid`,
      status: 'QUALIFIED',
      source: 'BrowserTest',
      assignedToId: user.id,
      propertyId: property.id
    },
    select: { id: true }
  })

  const deal = await prisma.deal.create({
    data: {
      referenceNumber: `${tag}-D1`,
      type: 'SALE',
      status: 'ACTIVE',
      organizationId: organization.id,
      userId: user.id,
      propertyId: property.id,
      leadId: lead.id,
      amount: 100000,
      currency: 'USD',
      exchangeRate: '1.00000000',
      baseAmount: 100000,
      notes: `${tag} browser verification deal`
    },
    select: { id: true }
  })

  await prisma.propertyActivity.create({
    data: {
      propertyId: property.id,
      userId: user.id,
      action: 'PROPERTY_CREATED',
      details: `${tag} browser fixture`
    }
  })

  await fs.mkdir(path.dirname(metadataPath), { recursive: true })
  await fs.writeFile(metadataPath, JSON.stringify({
    runId,
    tag,
    email: user.email,
    password,
    organizationId: organization.id,
    userId: user.id,
    propertyId: property.id,
    leadId: lead.id,
    dealId: deal.id
  }, null, 2), { mode: 0o600 })

  console.log('BROWSER_FIXTURE=CREATED')
  console.log(`BROWSER_FIXTURE_TAG=${tag}`)
}

async function cleanup() {
  let metadata
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  } catch {
    console.log('BROWSER_FIXTURE=NO_METADATA')
    return
  }

  await prisma.deal.deleteMany({ where: { id: metadata.dealId } })
  await prisma.lead.deleteMany({ where: { id: metadata.leadId } })
  if (metadata.uiLeadId) await prisma.lead.deleteMany({ where: { id: metadata.uiLeadId } })
  await prisma.propertyActivity.deleteMany({ where: { propertyId: metadata.propertyId } })
  if (metadata.uiPropertyId) {
    await prisma.propertyActivity.deleteMany({ where: { propertyId: metadata.uiPropertyId } })
    await prisma.propertyImage.deleteMany({ where: { propertyId: metadata.uiPropertyId } })
    await prisma.propertyDocument.deleteMany({ where: { propertyId: metadata.uiPropertyId } })
    await prisma.property.deleteMany({ where: { id: metadata.uiPropertyId } })
  }
  await prisma.property.deleteMany({ where: { id: metadata.propertyId } })
  await prisma.auditLog.deleteMany({ where: { userId: metadata.userId } })
  await prisma.user.deleteMany({ where: { id: metadata.userId } })
  await prisma.organization.deleteMany({ where: { id: metadata.organizationId } })

  const remaining = await Promise.all([
    prisma.organization.count({ where: { id: metadata.organizationId } }),
    prisma.user.count({ where: { organizationId: metadata.organizationId } }),
    prisma.property.count({ where: { organizationId: metadata.organizationId } }),
    prisma.lead.count({ where: { id: { in: [metadata.leadId, metadata.uiLeadId].filter(Boolean) } } }),
    prisma.deal.count({ where: { id: metadata.dealId } })
  ])
  if (remaining.some((count) => count !== 0)) throw new Error(`Cleanup verification failed: ${remaining.join(',')}`)
  await fs.unlink(metadataPath)

  console.log('BROWSER_FIXTURE_VERIFY=OK')
  console.log('BROWSER_FIXTURE=CLEANED')
}

async function main() {
  const command = process.argv[2] || 'create'
  if (command === 'create') await create()
  else if (command === 'cleanup') await cleanup()
  else throw new Error(`Unsupported command: ${command}`)
}

main()
  .catch((error) => {
    console.log(`BROWSER_FIXTURE_ERROR=${String(error.message || error).slice(0, 200)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
