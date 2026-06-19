import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router'

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

export default function History() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [transactions, setTransactions] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loadingTx, setLoadingTx] = useState(true)
  const [refundingId, setRefundingId] = useState(null)

  const page = parseInt(searchParams.get('page')) || 1
  const limit = parseInt(searchParams.get('limit')) || 10

  const fetchTransactions = useCallback(async () => {
    setLoadingTx(true)
    try {
      const res = await fetch(`/api/transactions?page=${page}&limit=${limit}`)
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.data || [])
        setPagination(data.pagination || null)
      }
    } catch {
      // silently fail
    } finally {
      setLoadingTx(false)
    }
  }, [page, limit])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  function goToPage(newPage) {
    setSearchParams({ page: String(newPage), limit: String(limit) })
  }

  async function handleRefund(txId, e) {
    e.preventDefault()
    e.stopPropagation()
    setRefundingId(txId)
    try {
      await fetch(`/api/transactions/${txId}/refund`, { method: 'POST' })
      fetchTransactions()
    } catch {
      // silently fail
    } finally {
      setRefundingId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Histórico de Transações</h1>
        <p className="page-subtitle">
          {pagination ? `${pagination.total} transações registradas` : 'Carregando...'}
        </p>
      </div>

      {loadingTx ? (
        <div className="loading-container">
          <span className="spinner"></span>
          Carregando transações...
        </div>
      ) : (
        <>
          <div className="list-transactions" data-testid="list-transactions">
            {transactions.map((tx) => (
              <Link
                to={`/transaction/${tx.id}`}
                key={tx.id}
                className="transaction-item"
                data-testid="transaction-item"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="tx-main-info">
                  <div className="tx-field">
                    <span className="tx-field-label">ID</span>
                    <span
                      className="tx-field-value transaction-id"
                      data-value={tx.id}
                    >
                      {tx.id.slice(0, 8)}…
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Status</span>
                    <span
                      className="transaction-status"
                      data-value={tx.status}
                    >
                      <StatusBadge status={tx.status} />
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Valor</span>
                    <span
                      className="tx-field-value transaction-amount"
                      data-value={tx.amount_cents}
                    >
                      {formatCents(tx.amount_cents)}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Bandeira</span>
                    <span
                      className="tx-field-value transaction-brand"
                      data-value={tx.card_brand}
                    >
                      {tx.card_brand}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Parcelas</span>
                    <span
                      className="tx-field-value transaction-installments"
                      data-value={tx.installments}
                    >
                      {tx.installments}x
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Vlr. Parcela</span>
                    <span
                      className="tx-field-value transaction-installment-amount"
                      data-value={tx.installment_amount}
                    >
                      {formatCents(tx.installment_amount)}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Total c/ Juros</span>
                    <span
                      className="tx-field-value transaction-total"
                      data-value={tx.total_with_interest}
                    >
                      {formatCents(tx.total_with_interest)}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Taxa</span>
                    <span
                      className="tx-field-value transaction-fee"
                      data-value={tx.fee_cents}
                    >
                      {formatCents(tx.fee_cents)}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Descrição</span>
                    <span
                      className="tx-field-value transaction-description"
                      data-value={tx.description}
                    >
                      {tx.description}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Cartão</span>
                    <span
                      className="tx-field-value transaction-card"
                      data-value={tx.card_last4}
                    >
                      •••• {tx.card_last4}
                    </span>
                  </div>

                  <div className="tx-field">
                    <span className="tx-field-label">Data</span>
                    <span
                      className="tx-field-value transaction-date"
                      data-value={tx.created_at}
                    >
                      {new Date(tx.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>

                <div>
                  {tx.status === 'approved' && (
                    <button
                      className="btn btn-danger btn-sm btn-refund"
                      data-testid={`btn-refund-${tx.id}`}
                      disabled={refundingId === tx.id}
                      onClick={(e) => handleRefund(tx.id, e)}
                    >
                      {refundingId === tx.id ? (
                        <span className="spinner"></span>
                      ) : (
                        'Estornar'
                      )}
                    </button>
                  )}
                </div>
              </Link>
            ))}

            {transactions.length === 0 && (
              <div className="loading-container">
                Nenhuma transação encontrada
              </div>
            )}
          </div>

          {/* ─── Paginação ─────────────────────── */}
          {pagination && (
            <div className="pagination-bar">
              <button
                className="btn btn-outline btn-sm btn-prev-page"
                data-testid="btn-prev-page"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                ← Anterior
              </button>

              <div className="pagination-info">
                <span>
                  Página{' '}
                  <strong
                    className="pagination-current"
                    data-value={pagination.page}
                  >
                    {pagination.page}
                  </strong>{' '}
                  de{' '}
                  <strong
                    className="pagination-pages"
                    data-value={pagination.total_pages}
                  >
                    {pagination.total_pages}
                  </strong>
                </span>
                <span className="pagination-total" data-value={pagination.total}>
                  ({pagination.total} total)
                </span>
              </div>

              <button
                className="btn btn-outline btn-sm btn-next-page"
                data-testid="btn-next-page"
                disabled={page >= pagination.total_pages}
                onClick={() => goToPage(page + 1)}
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
