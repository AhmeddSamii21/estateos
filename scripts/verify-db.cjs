require('dotenv/config')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function safeCode(error) {
  if (error && typeof error === 'object') {
    return String(error.errorCode || error.code || error.name || 'UnknownError')
  }
  return 'UnknownError'
}

async function main() {
  await prisma.$connect()
  const rows = await prisma.$queryRaw`SELECT 1 AS ok`
  const roleRows = await prisma.$queryRaw`SELECT 1 AS present FROM pg_roles WHERE rolname = ${'estateos_app'}`
  const dbRows = await prisma.$queryRaw`SELECT 1 AS present FROM pg_database WHERE datname = ${'estateos_db'}`

  console.log('DB_CONNECT=OK')
  console.log(`SELECT_1=${Array.isArray(rows) && rows.length === 1 && rows[0].ok === 1 ? 'OK' : 'UNEXPECTED'}`)
  console.log(`ROLE_estateos_app=${roleRows.length > 0 ? 'PRESENT' : 'MISSING'}`)
  console.log(`DB_estateos_db=${dbRows.length > 0 ? 'PRESENT' : 'MISSING'}`)
}

main()
  .catch((error) => {
    console.log('DB_CONNECT=FAIL')
    console.log(`ERROR_CODE=${safeCode(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
