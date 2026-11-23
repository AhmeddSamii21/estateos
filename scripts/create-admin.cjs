require('dotenv/config')

const readline = require('node:readline')
const { PrismaClient, Role } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function readSecret() {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    let received = false
    rl.on('line', (line) => {
      if (!received) {
        received = true
        resolve(line)
        rl.close()
      }
    })
    rl.on('close', () => {
      if (!received) reject(new Error('No password was provided.'))
    })
    rl.on('error', reject)
  })
}

async function main() {
  const email = arg('email').trim().toLowerCase()
  const firstName = arg('firstName').trim()
  const slug = arg('slug', 'estateos').trim() || 'estateos'

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('A valid --email is required.')
  }

  const password = await readSecret()
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new Error('A user with this email already exists. No changes were made.')
  }

  let organization = await prisma.organization.findUnique({ where: { slug } })
  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: process.env.COMPANY_NAME || 'EstateOS',
        slug,
        currency: process.env.DEFAULT_CURRENCY || 'USD',
        baseCurrency: process.env.DEFAULT_CURRENCY || 'USD'
      }
    })
  }

  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 12),
      role: Role.ADMIN,
      firstName: firstName || undefined,
      organizationId: organization.id,
      isActive: true
    },
    select: { id: true, email: true, role: true, organizationId: true }
  })

  console.log('Administrator created successfully.')
  console.log(`ID: ${user.id}`)
  console.log(`Email: ${user.email}`)
  console.log(`Role: ${user.role}`)
  console.log(`Organization: ${slug}`)
  console.log('The password is not displayed. Store it securely.')
}

main()
  .catch((error) => {
    console.error(`Administrator creation failed: ${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
