import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'
import { PrismaClient } from '../generated/prisma/client.ts'

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../../data.db')
const dbUrl = pathToFileURL(dbPath).href

const libsql = createClient({ url: dbUrl })

await libsql.execute('PRAGMA journal_mode = WAL')
await libsql.execute('PRAGMA busy_timeout = 10000')
await libsql.execute('PRAGMA synchronous = NORMAL')
await libsql.execute('PRAGMA cache_size = -64000')
await libsql.execute('PRAGMA temp_store = MEMORY')

const adapter = new PrismaLibSql({ url: dbUrl })
const prisma = new PrismaClient({
  adapter
})

export { libsql }
export default prisma
