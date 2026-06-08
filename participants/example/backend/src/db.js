import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Configura PRAGMAs do SQLite para performance e concorrencia
try {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000')
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL')
  await prisma.$queryRawUnsafe('PRAGMA temp_store = MEMORY')
} catch (err) {
  console.warn('PRAGMA setup warning:', err.message)
}

// Mutex para serializar escritas no SQLite (evita SQLITE_BUSY)
let writeLock = Promise.resolve()

export function withWriteLock(fn) {
  const prev = writeLock
  let resolve
  writeLock = new Promise(r => { resolve = r })
  return prev.then(fn).finally(resolve)
}

export default prisma
