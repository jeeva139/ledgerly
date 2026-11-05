import { History, Undo2 } from 'lucide-react'
import type { ImportHistoryEntry } from '@shared/api/imports'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { useConfirm } from '@/components/Confirm'
import { EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Card } from '@/components/layout'
import { useToast } from '@/components/Toasts'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'

const FORMAT_LABEL = { qif: 'QIF', csv: 'CSV', excel: 'Excel' } as const

function StatusPill({ status }: { status: ImportHistoryEntry['status'] }) {
  if (status === 'undone') return <span className="pill">Undone</span>
  if (status === 'partial') return <span className="pill warning">Partial</span>
  return <span className="pill positive">Complete</span>
}

export function HistoryTab() {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const q = useQuery(() => api.import.history(), [])

  const undo = async (h: ImportHistoryEntry) => {
    const edited = h.edited > 0 ? `\n\n${h.edited.toLocaleString()} of them ${h.edited === 1 ? 'has' : 'have'} been edited since the import and will be removed too.` : ''
    const ok = await confirm({
      title: 'Undo this import?',
      message: `This removes the ${h.remaining.toLocaleString()} transactions that still exist from “${h.filename}”.${edited}\n\nTransactions from other imports or added by hand are not touched.`,
      confirmLabel: 'Undo import',
      danger: true
    })
    if (!ok) return
    try {
      const { removed } = await api.import.undo({ importId: h.id })
      toast.success(`Removed ${removed.toLocaleString()} transactions.`)
      app.bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (q.error && !q.data) return <ErrorState message={q.error} onRetry={q.reload} />
  if (!q.data) return <Loading label="Loading import history…" />
  if (q.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={History} title="No imports yet">
          Import a statement and it will be listed here, with how many transactions were added and skipped.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card flush className="imp-hist">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Filename</th>
              <th>Format</th>
              <th>Account</th>
              <th className="num">Inserted</th>
              <th className="num">Duplicates</th>
              <th className="num">Skipped</th>
              <th className="num">Needs review</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((h) => (
              <tr key={h.id}>
                <td>{app.fmt.dateTime(h.createdAt)}</td>
                <td className="file">{h.filename}</td>
                <td>{FORMAT_LABEL[h.format] ?? h.format}</td>
                <td>{h.account || '—'}</td>
                <td className="num">{h.inserted.toLocaleString()}</td>
                <td className="num">{h.duplicates.toLocaleString()}</td>
                <td className="num">{h.skipped.toLocaleString()}</td>
                <td className="num">{h.needsReview.toLocaleString()}</td>
                <td>
                  <StatusPill status={h.status} />
                </td>
                <td className="actions">
                  {h.status !== 'undone' && h.remaining > 0 && (
                    <Button size="sm" icon={Undo2} onClick={() => void undo(h)} aria-label={`Undo import of ${h.filename}`}>
                      Undo
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
