import { useState } from 'react'
import { ArrowLeft, Check, Lock, SearchX } from 'lucide-react'
import { categoryLabel } from '@shared/types'
import type { FinderApplyResult, FinderPage, FinderSelectOp, FinderSummary } from '@shared/api/categoryFinder'
import { api, ApiError, errorMessage } from '@/services/api'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { Button } from '@/components/Button'
import { Card, Pagination } from '@/components/layout'
import { Alert, EmptyState, ErrorState, Loading, Pill } from '@/components/feedback'
import { CategoryLabel, Money } from '@/components/domain'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { HighlightedText } from './HighlightedText'

interface Props {
  summary: FinderSummary
  /** Back to the form (keeps the typed values). The preview is discarded. */
  onBack: () => void
  onApplied: (result: FinderApplyResult) => void
}

/** Step 3: preview. Selection lives on the server so it works across pages and for very large result sets. */
export function FinderResults({ summary, onBack, onApplied }: Props) {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selVersion, setSelVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const q = useQuery<FinderPage>(
    () => api.categoryFinder.page({ sessionId: summary.sessionId, page, pageSize }),
    [summary.sessionId, page, pageSize, selVersion]
  )
  const rows = q.data?.rows ?? []
  const selectedCount = q.data?.selectedCount ?? summary.selectedCount
  const categoryName = categoryLabel(summary.category)

  const fail = (e: unknown) => {
    toast.error(errorMessage(e))
    if (e instanceof ApiError && e.code === 'NOT_FOUND') onBack()
  }

  const selectOp = async (op: FinderSelectOp) => {
    setBusy(true)
    try {
      await api.categoryFinder.select({ sessionId: summary.sessionId, op })
      setSelVersion((v) => v + 1)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (ids: string[], selected: boolean) => {
    try {
      await api.categoryFinder.toggle({ sessionId: summary.sessionId, ids, selected })
      setSelVersion((v) => v + 1)
    } catch (e) {
      fail(e)
    }
  }

  const doApply = async () => {
    const ok = await confirm({
      title: `Apply ${categoryName} to ${selectedCount.toLocaleString()} selected ${selectedCount === 1 ? 'transaction' : 'transactions'}?`,
      message:
        'Only the category will change. Amounts, dates, merchants and accounts stay exactly as they are.\nYou can change any category again later in Transactions.',
      confirmLabel: 'Apply category'
    })
    if (!ok) return
    setApplying(true)
    try {
      const result = await api.categoryFinder.apply({ sessionId: summary.sessionId })
      onApplied(result) // leave the preview first: its session was consumed by apply
      app.bump()
    } catch (e) {
      fail(e)
    } finally {
      setApplying(false)
    }
  }

  // ---- nothing found ----
  if (summary.total === 0) {
    return (
      <Card>
        <EmptyState
          icon={SearchX}
          title="No transactions match"
          action={
            <Button variant="primary" icon={ArrowLeft} onClick={onBack}>
              Change keywords
            </Button>
          }
        >
          Ledgerly searched {summary.scanned.toLocaleString()} {summary.scanned === 1 ? 'transaction' : 'transactions'} for{' '}
          {summary.keywords.join(', ')} and found nothing. Check the spelling, or{summary.wholeWord ? ' turn off “Match whole words only”, or' : ''} try a shorter keyword.
        </EmptyState>
      </Card>
    )
  }

  const pageIds = rows.map((r) => r.id)
  const pageSelected = rows.filter((r) => r.selected).length
  const allOnPage = rows.length > 0 && pageSelected === rows.length

  return (
    <>
      <Card>
        <div className="finder-summary">
          <div className="stack">
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted">Category:</span>
              <strong>
                <CategoryLabel name={summary.category} />
              </strong>
            </div>
            <div className="stack sm">
              <span className="muted">Keywords:</span>
              <div className="kw-chips">
                {summary.perKeyword.map((k) => (
                  <span key={k.keyword} className="kw-chip" title={`${k.count.toLocaleString()} matching transactions`}>
                    {k.keyword} <span className="count">· {k.count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="finder-found" aria-live="polite">
            <div className="muted">Found:</div>
            <div className="big">{summary.total.toLocaleString()}</div>
            <div className="muted">{summary.total === 1 ? 'transaction' : 'transactions'}</div>
          </div>
        </div>
      </Card>

      {summary.lockedElsewhere > 0 && (
        <Alert kind="info">
          <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
            <Lock size={14} aria-hidden />
            <strong>{summary.lockedElsewhere.toLocaleString()}</strong>
          </span>{' '}
          {summary.lockedElsewhere === 1 ? 'match was' : 'matches were'} categorized manually, so {summary.lockedElsewhere === 1 ? 'it is' : 'they are'} unticked to protect your choice. Tick{' '}
          {summary.lockedElsewhere === 1 ? 'it' : 'them'} if you want to override.
        </Alert>
      )}
      {summary.alreadyInCategory > 0 && (
        <Alert kind="info">
          {summary.alreadyInCategory.toLocaleString()} {summary.alreadyInCategory === 1 ? 'match is' : 'matches are'} already in <strong>{categoryName}</strong> and {summary.alreadyInCategory === 1 ? 'is' : 'are'} unticked.
        </Alert>
      )}

      <Card flush>
        <div className="row between wrap" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="finder-select-tools" role="group" aria-label="Selection">
            <Button size="sm" onClick={() => void selectOp('all')} disabled={busy}>
              Select all
            </Button>
            <Button size="sm" onClick={() => void selectOp('none')} disabled={busy}>
              Select none
            </Button>
            <Button size="sm" onClick={() => void selectOp('invert')} disabled={busy}>
              Invert selection
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void selectOp('default')} disabled={busy} title="Tick everything except protected and already-categorized rows">
              Reset
            </Button>
          </div>
          <span className="muted" aria-live="polite">
            {selectedCount.toLocaleString()} of {summary.total.toLocaleString()} selected
          </span>
        </div>

        {q.error ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : !q.data ? (
          <Loading label="Loading matches…" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Matching transactions</caption>
                <thead>
                  <tr>
                    <th className="check-col" scope="col">
                      <label className="check">
                        <input
                          type="checkbox"
                          aria-label="Select all transactions on this page"
                          checked={allOnPage}
                          ref={(el) => {
                            if (el) el.indeterminate = pageSelected > 0 && !allOnPage
                          }}
                          onChange={(e) => void toggle(pageIds, e.target.checked)}
                        />
                      </label>
                    </th>
                    <th scope="col">Date</th>
                    <th scope="col">Transaction</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Current category</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.selected ? 'selected' : undefined}>
                      <td className="check-col">
                        <label className="check">
                          <input
                            type="checkbox"
                            aria-label={`Select transaction ${r.text.slice(0, 60)}`}
                            checked={r.selected}
                            onChange={(e) => void toggle([r.id], e.target.checked)}
                          />
                        </label>
                      </td>
                      <td className="nowrap">{app.fmt.date(r.date)}</td>
                      <td>
                        <div className="finder-text">
                          <HighlightedText text={r.text} hits={r.hits} />
                          <span className="acct">{r.account}</span>
                        </div>
                        <div className="finder-hits">
                          {r.hits.map((h) => (
                            <span key={h.keyword} className="pill accent" title={`Matched keyword: ${h.keyword}`}>
                              Matched keyword: {h.keyword}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num">
                        <Money amount={r.amount} type={r.type} />
                      </td>
                      <td>
                        <div className="finder-cat">
                          <CategoryLabel name={r.currentCategory} />
                          {r.alreadyInCategory && <Pill tone="positive">Already {categoryName}</Pill>}
                          {r.categoryLocked && !r.alreadyInCategory && (
                            <Pill tone="warning" title="You chose this category yourself, so it is protected unless you tick the row">
                              <Lock size={11} aria-hidden /> Manual
                            </Pill>
                          )}
                          {r.isTransfer && <Pill tone="info">Transfer</Pill>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={q.data.page}
              pageSize={pageSize}
              total={q.data.total}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n)
                setPage(1)
              }}
            />
          </>
        )}
      </Card>

      <section className="card finder-bar" aria-label="Apply category">
        <div className="stack sm">
          <strong>
            {summary.total.toLocaleString()} matching {summary.total === 1 ? 'transaction' : 'transactions'}
          </strong>
          <span className="muted">
            Category: <strong style={{ color: 'var(--text)' }}>{categoryName}</strong> · {selectedCount.toLocaleString()} selected
          </span>
        </div>
        <div className="row">
          <Button onClick={onBack} disabled={applying}>
            Cancel
          </Button>
          <Button variant="primary" icon={Check} disabled={selectedCount === 0} loading={applying} onClick={() => void doApply()}>
            Apply to Selected
          </Button>
        </div>
      </section>
    </>
  )
}
