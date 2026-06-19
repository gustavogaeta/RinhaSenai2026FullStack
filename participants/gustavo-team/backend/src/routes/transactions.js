import prisma, { libsql } from '../db.js'
import { randomUUID } from 'node:crypto'

// ============================================================
// CONSTANTES DE NEGÓCIO (tudo em centavos — NUNCA float)
// ============================================================
const DAILY_LIMIT_CENTS = 500000            // R$5.000,00
const MIN_INSTALLMENT_CENTS = 1000          // R$10,00
const MAX_AMOUNT_CENTS = 1000000            // R$10.000,00
const MAX_INSTALLMENTS = 12

// Taxas por bandeira (primeiro dígito do cartão)
const BRAND_MAP = {
  '4': { brand: 'visa',       rate: 0.025 },
  '5': { brand: 'mastercard', rate: 0.030 },
  '3': { brand: 'amex',       rate: 0.035 },
  '6': { brand: 'elo',        rate: 0.040 },
}

// Taxa de juros compostos por faixa de parcelas
function getInterestRate(installments) {
  if (installments <= 1) return 0
  if (installments <= 6) return 0.02  // 2% ao mês
  return 0.04                          // 4% ao mês
}

// ============================================================
// MUTEX em memória para serializar escritas por idempotency_key
// Garante atomicidade sem depender de locks do SQLite
// ============================================================
const lockMap = new Map()

async function withLock(key, fn) {
  const current = lockMap.get(key) || Promise.resolve()
  let resolveLock
  const next = new Promise(resolve => {
    resolveLock = resolve
  })
  lockMap.set(key, next)
  try {
    await current
    return await fn()
  } finally {
    resolveLock()
    if (lockMap.get(key) === next) {
      lockMap.delete(key)
    }
  }
}

// ============================================================
// VALIDAÇÕES
// ============================================================
function validateTransaction(body) {
  const errors = []

  const { card_number, holder_name, expiration, cvv, amount_cents, installments, description } = body || {}

  // card_number: exatamente 16 dígitos numéricos
  if (!card_number || !/^\d{16}$/.test(card_number)) {
    errors.push('card_number deve ter exatamente 16 digitos numericos')
  }

  // holder_name: não vazio, max 50 chars, sem HTML tags
  if (!holder_name || typeof holder_name !== 'string' || holder_name.trim().length === 0) {
    errors.push('holder_name e obrigatorio')
  } else if (holder_name.length > 50) {
    errors.push('holder_name max 50 caracteres')
  } else if (/<[^>]*>/.test(holder_name)) {
    errors.push('holder_name nao pode conter tags HTML')
  }

  // expiration: formato MM/YY, não vencido
  if (!expiration || !/^\d{2}\/\d{2}$/.test(expiration)) {
    errors.push('expiration deve estar no formato MM/YY')
  } else {
    const [mm, yy] = expiration.split('/').map(Number)
    if (mm < 1 || mm > 12) {
      errors.push('expiration mes invalido')
    } else {
      const now = new Date()
      const expYear = 2000 + yy
      const expMonth = mm
      // Cartão é válido até o fim do mês de expiração
      if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
        errors.push('cartao vencido')
      }
    }
  }

  // cvv: 3 ou 4 dígitos
  if (!cvv || !/^\d{3,4}$/.test(cvv)) {
    errors.push('cvv deve ter 3 ou 4 digitos')
  }

  // amount_cents: > 0 e <= 1000000
  if (amount_cents == null || typeof amount_cents !== 'number' || !Number.isInteger(amount_cents) || amount_cents <= 0 || amount_cents > MAX_AMOUNT_CENTS) {
    errors.push('amount_cents deve ser inteiro > 0 e <= 1000000')
  }

  // installments: 1 a 12
  const inst = installments == null ? 1 : installments
  if (!Number.isInteger(inst) || inst < 1 || inst > MAX_INSTALLMENTS) {
    errors.push('installments deve ser inteiro de 1 a 12')
  }

  // description: obrigatória, max 100
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    errors.push('description e obrigatoria')
  } else if (description.length > 100) {
    errors.push('description max 100 caracteres')
  }

  return errors
}

// ============================================================
// CÁLCULOS FINANCEIROS (tudo em inteiros/centavos)
// ============================================================
function calculateTransaction(amountCents, installments, brandInfo) {
  const interestRate = getInterestRate(installments)

  // Juros compostos: M = P * (1 + i)^n
  // Usamos Math.ceil conforme especificação
  const totalWithInterest = (interestRate === 0)
    ? amountCents
    : Math.ceil(amountCents * Math.pow(1 + interestRate, installments))

  // Valor da parcela com arredondamento para cima
  const installmentAmount = Math.ceil(totalWithInterest / installments)

  // Taxa da bandeira é calculada sobre o amount_cents (valor original)
  // Validado pelo teste: 15000 * 0.025 = 375 para Visa
  const feeCents = Math.round(amountCents * brandInfo.rate)

  // Valor líquido = amount_cents original - taxa
  const netAmount = amountCents - feeCents

  return { totalWithInterest, installmentAmount, feeCents, netAmount }
}

// ============================================================
// ROTAS
// ============================================================
export default async function (fastify) {

  // ─── Health Check ───────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok' }))

  // ─── POST /transactions ─────────────────────────────────
  fastify.post('/transactions', async (req, reply) => {
    const body = req.body || {}
    const installments = body.installments == null ? 1 : body.installments

    // 1. Validações de campos
    const errors = validateTransaction(body)
    if (errors.length > 0) {
      return reply.code(422).send({ error: errors.join('; ') })
    }

    // 2. Verificar se é cartão 9999 (declined) ANTES da validação de bandeira
    const isDeclinedCard = body.card_number.startsWith('9999')

    // 3. Verificar bandeira
    const firstDigit = body.card_number[0]
    let brandInfo = BRAND_MAP[firstDigit]
    if (!brandInfo && !isDeclinedCard) {
      return reply.code(422).send({ error: 'Bandeira desconhecida' })
    }
    // Cartões 9999 sem bandeira válida usam placeholder
    if (!brandInfo) {
      brandInfo = { brand: 'unknown', rate: 0 }
    }

    // 4. Cálculos financeiros
    const { totalWithInterest, installmentAmount, feeCents, netAmount } =
      calculateTransaction(body.amount_cents, installments, brandInfo)

    // 5. Verificar parcela mínima R$10,00 (não aplica a cartões que já serão declined)
    if (!isDeclinedCard && installmentAmount < MIN_INSTALLMENT_CENTS) {
      return reply.code(422).send({ error: 'Valor minimo por parcela e R$10,00' })
    }

    const cardLast4 = body.card_number.slice(-4)
    const idempotencyKey = body.idempotency_key || null

    // 6. Idempotência com lock em memória para prevenir race condition
    if (idempotencyKey) {
      return withLock(`idem:${idempotencyKey}`, async () => {
        // Verificar se já existe transação com essa key
        const existing = await prisma.transaction.findUnique({
          where: { idempotencyKey }
        })
        if (existing) {
          // Retorna a transação existente com status 200
          return reply.code(200).send(formatResponse(existing))
        }

        // Criar a transação
        return await createTransaction(reply, {
          body, brandInfo, cardLast4, installments,
          totalWithInterest, installmentAmount, feeCents, netAmount, idempotencyKey,
          isDeclinedCard
        })
      })
    }

    // Sem idempotency key, criar diretamente
    return await createTransaction(reply, {
      body, brandInfo, cardLast4, installments,
      totalWithInterest, installmentAmount, feeCents, netAmount, idempotencyKey,
      isDeclinedCard
    })
  })

  // ─── GET /transactions/:id ──────────────────────────────
  fastify.get('/transactions/:id', async (req, reply) => {
    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.id }
    })
    if (!tx) {
      return reply.code(404).send({ error: 'Transacao nao encontrada' })
    }
    return reply.code(200).send(formatResponse(tx))
  })

  // ─── GET /transactions (paginação) ──────────────────────
  fastify.get('/transactions', async (req, reply) => {
    let page = parseInt(req.query.page) || 1
    let limit = parseInt(req.query.limit) || 10
    if (page < 1) page = 1
    if (limit < 1) limit = 1
    if (limit > 100) limit = 100

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count(),
    ])

    const totalPages = Math.ceil(total / limit)

    return reply.code(200).send({
      data: transactions.map(formatResponse),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    })
  })

  // ─── POST /transactions/:id/refund ──────────────────────
  fastify.post('/transactions/:id/refund', async (req, reply) => {
    const { id } = req.params

    // Lock por transação para prevenir double refund concorrente
    return withLock(`refund:${id}`, async () => {
      // UPDATE atômico: só altera se status = 'approved'
      // Isso previne double refund mesmo sob concorrência
      const result = await prisma.transaction.updateMany({
        where: { id, status: 'approved' },
        data: { status: 'refunded' },
      })

      if (result.count === 0) {
        // Ou não existe, ou já foi estornada/recusada
        const tx = await prisma.transaction.findUnique({ where: { id } })
        if (!tx) {
          return reply.code(404).send({ error: 'Transacao nao encontrada' })
        }
        return reply.code(422).send({ error: `Transacao com status ${tx.status} nao pode ser estornada` })
      }

      const tx = await prisma.transaction.findUnique({ where: { id } })
      return reply.code(200).send(formatResponse(tx))
    })
  })

  // ─── GET /balance ───────────────────────────────────────
  fastify.get('/balance', async (req, reply) => {
    // Usa raw SQL para performance — uma query só
    const result = await libsql.execute(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'approved' THEN net_amount ELSE 0 END), 0) as balance_cents,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as total_approved,
        COALESCE(SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END), 0) as total_declined,
        COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) as total_refunded
      FROM transactions
    `)

    const row = result.rows[0]
    return reply.code(200).send({
      balance_cents: Number(row.balance_cents),
      total_approved: Number(row.total_approved),
      total_declined: Number(row.total_declined),
      total_refunded: Number(row.total_refunded),
    })
  })
}

// ============================================================
// HELPERS
// ============================================================

async function createTransaction(reply, opts) {
  const {
    body, brandInfo, cardLast4, installments,
    totalWithInterest, installmentAmount, feeCents, netAmount, idempotencyKey,
    isDeclinedCard
  } = opts

  // Determinar status
  let status = 'approved'
  if (isDeclinedCard) {
    status = 'declined'
  }

  // Verificar limite diário (só para transações que seriam aprovadas)
  // Usa lock por card para prevenir race condition no limite diário
  if (status === 'approved') {
    const declined = await withLock(`card:${cardLast4}`, async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const dailyResult = await libsql.execute({
        sql: `SELECT COALESCE(SUM(amount_cents), 0) as total
              FROM transactions
              WHERE card_last4 = ? AND status = 'approved' AND created_at >= ?`,
        args: [cardLast4, today.toISOString()]
      })

      const dailyTotal = Number(dailyResult.rows[0].total)
      if (dailyTotal + body.amount_cents > DAILY_LIMIT_CENTS) {
        return true // exceeded
      }

      // Insert inside the lock to keep check+write atomic
      const id = randomUUID()
      const now = new Date().toISOString()

      try {
        await prisma.transaction.create({
          data: {
            id,
            status: 'approved',
            cardLast4: cardLast4,
            cardBrand: brandInfo.brand,
            holderName: body.holder_name,
            amountCents: body.amount_cents,
            installments,
            installmentAmount,
            totalWithInterest,
            feeCents,
            netAmount,
            description: body.description,
            idempotencyKey,
            createdAt: now,
          },
        })
      } catch (err) {
        if (err.code === 'P2002' || (err.message && err.message.includes('UNIQUE'))) {
          const existing = await prisma.transaction.findUnique({
            where: { idempotencyKey }
          })
          if (existing) {
            return { existing }
          }
        }
        throw err
      }

      const tx = await prisma.transaction.findUnique({ where: { id } })
      return { created: tx }
    })

    // Handle results from inside the lock
    if (declined === true) {
      status = 'declined'
      // Fall through to create a declined transaction below
    } else if (declined.existing) {
      return reply.code(200).send(formatResponse(declined.existing))
    } else if (declined.created) {
      return reply.code(201).send(formatResponse(declined.created))
    }
  }

  // Create declined transaction (no lock needed — declined don't count towards limits)
  const id = randomUUID()
  const now = new Date().toISOString()

  try {
    await prisma.transaction.create({
      data: {
        id,
        status,
        cardLast4: cardLast4,
        cardBrand: brandInfo.brand,
        holderName: body.holder_name,
        amountCents: body.amount_cents,
        installments,
        installmentAmount,
        totalWithInterest,
        feeCents,
        netAmount,
        description: body.description,
        idempotencyKey,
        createdAt: now,
      },
    })
  } catch (err) {
    if (err.code === 'P2002' || (err.message && err.message.includes('UNIQUE'))) {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey }
      })
      if (existing) {
        return reply.code(200).send(formatResponse(existing))
      }
    }
    throw err
  }

  const tx = await prisma.transaction.findUnique({ where: { id } })
  return reply.code(201).send(formatResponse(tx))
}

function formatResponse(tx) {
  return {
    id: tx.id,
    status: tx.status,
    card_last4: tx.cardLast4,
    card_brand: tx.cardBrand,
    holder_name: tx.holderName,
    amount_cents: tx.amountCents,
    installments: tx.installments,
    installment_amount: tx.installmentAmount,
    total_with_interest: tx.totalWithInterest,
    fee_cents: tx.feeCents,
    net_amount: tx.netAmount,
    description: tx.description,
    created_at: tx.createdAt,
  }
}
