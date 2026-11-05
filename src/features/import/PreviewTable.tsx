import { useEffect, useRef, useState } from 'react'
import type { ImportPreview, PreviewFilter, PreviewRowDto, PreviewRowsPage } from '@shared/api/imports'
import { NEEDS_REVIEW } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { CategoryLabel, Money, NeedsReviewPill } from '@/components/domain'
import { EmptyState, ErrorState } from '@/components/feedback'
import { Card, Pagination, Tabs } from '@/components/layout'
import { api, errorMessage } from '@/services/api'
import { ListChecks } from 'lucide-react'

interface Props {
  preview: ImportPreview
  /** True while the preview is being recomputed (options changed). */
  busy: boolean
}

const FILTER_LABELS: { id: PreviewFilter; label: string; count: (p: ImportPreview) => number }[] = [
  { id: 'all', label: 'All', count: (p) => p.detected },
  { id: 'new', label: 'New', count: (p) => p.newCount },
  { id: 'duplicate', label: 'Duplicates', count: (p) => p.duplicates },
  { id: 'needs-review', label: 'Needs review', count: (p) => p.needsReview },
  { id: 'invalid', label: 'Skipped', count: (p) => p.invalid }
]

function StatusCell({ row }: { row: PreviewRowDto }) {
  if (row.status === 'invalid') return <span className="pill danger">Skipped</span>
  if (row.status === 'duplicate') return <span className="pill warning">Duplicate</span>
  if (row.repeated) return <span className="pill info" title={row.issue ?? undefined}>New · repeated</span>
  return <span className="pill positive">New</span>
}

export function PreviewTable({ preview, busy }: Props) {
  const { fmt } = useApp()
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<PreviewRowsPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const req = useRef(0)

  // A new preview (options changed) starts again from page 1.
  useEffect(() => setPage(1), [preview, filter, pageSize])

  useEffect(() => {
    const id = ++req.current
    api.import
      .previewRows({ sessionId: preview.sessionId, filter, page, pageSize })
      .then((d) => {
        if (id === req.current) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => id === req.current && setError(errorMessage(e)))
  }, [preview, filter, page, pageSize])

  return (
    <Card flush title="Preview" className="imp-preview-wrap">
      <div style={{ padding: '0 20px' }}>
        <Tabs
          label="Preview filter"
          value={filter}
          onChange={setFilter}
          tabs={FILTER_LABELS.map((f) => ({ id: f.id, label: `${f.label} (${f.count(preview).toLocaleString()})` }))}
        />
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !data ? null : data.rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nothing in this view" compact>
          {filter === 'all' ? 'No transactions were found.' : 'No rows match this filter.'}
        </EmptyState>
      ) : (
        <div className={busy ? 'imp-preview-wrap busy' : 'imp-preview-wrap'}>
          <div className="table-wrap" style={{ maxHeight: 460 }}>
            <table className="table imp-preview-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 56 }}>#</th>
                  <th>Date</th>
                  <th>Transaction</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.seq} className={`is-${r.status}`}>
                    <td className="num faint">{r.seq}</td>
                    <td className="nowrap">{r.date ? fmt.date(r.date) : <span title="Date could not be read">{r.rawDate || '—'}</span>}</td>
                    <td className="narr">
                      <div>{r.merchant}</div>
                      {r.memo && <div className="memo">{r.memo}</div>}
                      {r.issue && r.status !== 'new' && <div className="small" style={{ color: r.status === 'invalid' ? 'var(--danger-text)' : 'var(--text-muted)' }}>{r.issue}</div>}
                    </td>
                    <td>
                      {r.status === 'invalid' ? (
                        <span className="faint">—</span>
                      ) : r.isTransfer ? (
                        <span className="pill info">Transfer</span>
                      ) : r.category === NEEDS_REVIEW ? (
                        <NeedsReviewPill />
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <CategoryLabel name={r.category} />
                          {r.categorySource === 'rule' && <span className="pill accent" title="Applied from a saved rule">Rule</span>}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {r.amount !== null && r.type ? <Money amount={r.amount} type={r.type} /> : <span className="faint">—</span>}
                    </td>
                    <td>
                      <StatusCell row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} sizes={[25, 50, 100, 250]} />
        </div>
      )}
    </Card>
  )
}
