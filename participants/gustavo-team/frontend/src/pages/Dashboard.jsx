import { useState, useEffect, useCallback } from 'react'

function formatCents(cents) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

export default function Dashboard() {
  const [balance, setBalance] = useState(null)
  const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message }
  const [loading, setLoading] = useState(false)

  // Form state
  const [cardNumber, setCardNumber] = useState('')
  const [holderName, setHolderName] = useState('')
  const [expiration, setExpiration] = useState('')
  const [cvv, setCvv] = useState('')
  const [amountCents, setAmountCents] = useState('')
  const [installments, setInstallments] = useState('1')
  const [description, setDescription] = useState('')

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/balance')
      if (res.ok) {
        const data = await res.json()
        setBalance(data)
      }
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  async function handleSubmit(e) {
    e.preventDefault()
    setFeedback(null)
    setLoading(true)

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: cardNumber,
          holder_name: holderName,
          expiration,
          cvv,
          amount_cents: parseInt(amountCents, 10),
          installments: parseInt(installments, 10),
          description,
        }),
      })

      const data = await res.json()

      if (res.status === 201 || res.status === 200) {
        if (data.status === 'approved') {
          setFeedback({
            type: 'success',
            message: `Transação aprovada! ID: ${data.id} — ${formatCents(data.amount_cents)}`,
          })
        } else {
          setFeedback({
            type: 'error',
            message: `Transação recusada (${data.status})`,
          })
        }
        // Limpar formulário em sucesso
        setCardNumber('')
        setHolderName('')
        setExpiration('')
        setCvv('')
        setAmountCents('')
        setInstallments('1')
        setDescription('')
      } else {
        setFeedback({
          type: 'error',
          message: data.error || `Erro ${res.status}`,
        })
      }

      // Atualizar saldo após transação
      fetchBalance()
    } catch (err) {
      setFeedback({ type: 'error', message: 'Erro de conexão com o servidor' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Gateway de Pagamento</h1>
        <p className="page-subtitle">Processe transações com segurança e velocidade</p>
      </div>

      {/* ─── Stats / Balance ──────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Saldo Líquido</div>
          <div className="stat-value accent">
            <span
              className="display-balance"
              data-testid="display-balance"
              data-value={balance?.balance_cents ?? 0}
            >
              {balance ? formatCents(balance.balance_cents) : '—'}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Aprovadas</div>
          <div className="stat-value">
            <span
              className="display-total-approved"
              data-testid="display-total-approved"
              data-value={balance?.total_approved ?? 0}
            >
              {balance?.total_approved ?? '—'}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Recusadas</div>
          <div className="stat-value">
            <span
              className="display-total-declined"
              data-testid="display-total-declined"
              data-value={balance?.total_declined ?? 0}
            >
              {balance?.total_declined ?? '—'}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Estornadas</div>
          <div className="stat-value">
            <span
              className="display-total-refunded"
              data-testid="display-total-refunded"
              data-value={balance?.total_refunded ?? 0}
            >
              {balance?.total_refunded ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ─── Payment Form ─────────────────────── */}
      <div className="card">
        <div className="card-header">Nova Transação</div>
        <form onSubmit={handleSubmit} data-testid="payment-form">
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Número do Cartão</label>
              <input
                className="form-input input-card-number"
                data-testid="input-card-number"
                type="text"
                placeholder="0000 0000 0000 0000"
                maxLength={16}
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Nome do Titular</label>
              <input
                className="form-input input-holder-name"
                data-testid="input-holder-name"
                type="text"
                placeholder="Nome impresso no cartão"
                maxLength={50}
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Validade</label>
              <input
                className="form-input input-expiration"
                data-testid="input-expiration"
                type="text"
                placeholder="MM/YY"
                maxLength={5}
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">CVV</label>
              <input
                className="form-input input-cvv"
                data-testid="input-cvv"
                type="text"
                placeholder="123"
                maxLength={4}
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Valor (centavos)</label>
              <input
                className="form-input input-amount"
                data-testid="input-amount"
                type="number"
                placeholder="10000"
                min={1}
                max={1000000}
                value={amountCents}
                onChange={(e) => setAmountCents(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Parcelas</label>
              <select
                className="form-select select-installments"
                data-testid="select-installments"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}x {i === 0 ? '(sem juros)' : i < 6 ? '(2% a.m.)' : '(4% a.m.)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group full-width">
              <label className="form-label">Descrição</label>
              <input
                className="form-input input-description"
                data-testid="input-description"
                type="text"
                placeholder="Descrição da compra"
                maxLength={100}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="mt-24">
            <button
              type="submit"
              className="btn btn-primary btn-pay"
              data-testid="btn-pay"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Processando...
                </>
              ) : (
                '💳 Pagar'
              )}
            </button>
          </div>
        </form>

        {/* ─── Feedback ───────────────────────── */}
        {feedback?.type === 'success' && (
          <div className="feedback-success" data-testid="feedback-success">
            ✅ {feedback.message}
          </div>
        )}
        {feedback?.type === 'error' && (
          <div className="feedback-error" data-testid="feedback-error">
            ❌ {feedback.message}
          </div>
        )}
      </div>
    </div>
  )
}
