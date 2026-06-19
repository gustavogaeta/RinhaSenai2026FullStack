import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router'

function formatCents(cents) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-${status}`}>
      {status === 'approved' ? '✓' : status === 'declined' ? '✗' : '↺'} {status}
    </span>
  )
}

export default function Detail() {
  const { id } = useParams()
  const [tx, setTx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refunding, setRefunding] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/transactions/${id}`)
      if (res.ok) {
        const data = await res.json()
        setTx(data)
      } else {
        setError('Transação não encontrada ou erro na API')
      }
    } catch {
      setError('Erro de conexão com o servidor')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  async function handleRefund() {
    setRefunding(true)
    try {
      await fetch(`/api/transactions/${id}/refund`, { method: 'POST' })
      fetchDetail()
    } catch {
      // silently fail
    } finally {
      setRefunding(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <span className="spinner"></span> Carregando detalhes...
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="feedback-error">{error}</div>
        <div className="mt-16">
          <Link to="/history" className="btn btn-outline">← Voltar ao Histórico</Link>
        </div>
      </div>
    )
  }

  if (!tx) return null

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Detalhe da Transação</h1>
          <p className="page-subtitle detail-id" data-value={tx.id}>ID: {tx.id}</p>
        </div>
        <Link to="/history" className="btn btn-outline btn-sm">← Voltar</Link>
      </div>

      <div className="card">
        <div className="detail-grid">
          <div className="detail-field">
            <span className="detail-field-label">Status</span>
            <span className="detail-status" data-value={tx.status}>
              <StatusBadge status={tx.status} />
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Valor (amount_cents)</span>
            <span className="detail-field-value detail-amount" data-value={tx.amount_cents}>
              {formatCents(tx.amount_cents)}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Bandeira</span>
            <span className="detail-field-value detail-brand" data-value={tx.card_brand}>
              {tx.card_brand.toUpperCase()}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Titular</span>
            <span className="detail-field-value detail-holder" data-value={tx.holder_name}>
              {tx.holder_name}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Cartão</span>
            <span className="detail-field-value detail-card" data-value={tx.card_last4}>
              •••• {tx.card_last4}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Parcelas</span>
            <span className="detail-field-value detail-installments" data-value={tx.installments}>
              {tx.installments}x
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Valor Parcela</span>
            <span className="detail-field-value detail-installment-amount" data-value={tx.installment_amount}>
              {formatCents(tx.installment_amount)}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Total c/ Juros</span>
            <span className="detail-field-value detail-total" data-value={tx.total_with_interest}>
              {formatCents(tx.total_with_interest)}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Taxa (Fee)</span>
            <span className="detail-field-value detail-fee" data-value={tx.fee_cents}>
              {formatCents(tx.fee_cents)}
            </span>
          </div>

          <div className="detail-field">
            <span className="detail-field-label">Valor Líquido</span>
            <span className="detail-field-value detail-net" data-value={tx.net_amount}>
              {formatCents(tx.net_amount)}
            </span>
          </div>

          <div className="detail-field" style={{ gridColumn: '1 / -1' }}>
            <span className="detail-field-label">Descrição</span>
            <span className="detail-field-value detail-description" data-value={tx.description}>
              {tx.description}
            </span>
          </div>

          <div className="detail-field" style={{ gridColumn: '1 / -1' }}>
            <span className="detail-field-label">Data/Hora</span>
            <span className="detail-field-value detail-date" data-value={tx.created_at}>
              {new Date(tx.created_at).toLocaleString('pt-BR')} ({tx.created_at})
            </span>
          </div>
        </div>

        {tx.status === 'approved' && (
          <div className="mt-24" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-danger btn-refund"
              disabled={refunding}
              onClick={handleRefund}
            >
              {refunding ? (
                <>
                  <span className="spinner"></span> Processando...
                </>
              ) : (
                'Solicitar Estorno'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
