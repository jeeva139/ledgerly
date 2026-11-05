import { useState } from 'react'
import { CheckCircle2, AlertTriangle, ListFilter, Undo2, Wallet } from 'lucide-react'
import type { ImportReport } from '@shared/api/imports'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { useConfirm } from '@/components/Confirm'
import { Alert } from '@/components/feedback'
import { Card, StatCard } from '@/components/layout'
import { useToast } from '@/components/Toasts'
import { api, errorMessage } from '@/services/api'

/** Spec §35: Inserted · Duplicates skipped · Needs review · Invalid/skipped. */
export function ReportStep({ report, onAnother }: { report: ImportReport; onAnother: () => void }) {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [undone, setUndone] = useState(false)
  const [busy, setBusy] = useState(false)
  const partial = report.status === 'partial'

  const undo = async () => {
    const ok = await confirm({
      title: 'Undo this import?',
      message: `This removes the ${report.inserted.toLocaleString()} transactions that were added by this import.\n\nAny of them you have edited since will be removed too. Other transactions are not touched.`,
      confirmLabel: 'Undo import',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    try {
      const { removed } = await api.import.undo({ importId: report.importId })
      toast.success(`Removed ${removed.toLocaleString()} transactions.`)
      setUndone(true)
      app.bump()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack lg">
      <Card>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <span className="imp-file-icon" style={{ background: partial ? 'var(--warning-soft)' : 'var(--positive-soft)', color: partial ? 'var(--warning-text)' : 'var(--positive-text)' }}>
            {partial ? <AlertTriangle size={24} aria-hidden /> : <CheckCircle2 size={24} aria-hidden />}
          </span>
          <div>
            <h2>{partial ? 'Import stopped early' : 'Import complete'}</h2>
            <p className="muted">
              {report.filename}
              {undone && ' — this import was undone.'}
            </p>
          </div>
        </div>
      </Card>

      <div className="imp-report-grid">
        <StatCard label="Inserted" tone="positive" value={report.inserted.toLocaleString()} hint="New transactions added" />
        <StatCard label="Duplicates skipped" tone="info" value={report.duplicates.toLocaleString()} hint="Already in Ledgerly" />
        <StatCard label="Needs review" tone="spending" value={report.needsReview.toLocaleString()} hint="Waiting for a category" />
        <StatCard label="Invalid / skipped" tone="info" value={report.skipped.toLocaleString()} hint="Could not be read" />
      </div>

      {report.notes.map((n) => (
        <Alert key={n} kind={partial ? 'warning' : 'info'}>{n}</Alert>
      ))}
      {report.createdAccounts.length > 0 && <Alert kind="info">New account{report.createdAccounts.length === 1 ? '' : 's'} created: {report.createdAccounts.join(', ')}.</Alert>}
      {report.addedCategories.length > 0 && <Alert kind="info">Added to your categories: {report.addedCategories.join(', ')}.</Alert>}
      {report.documentKept && <Alert kind="info">A copy of the original file is stored in your Documents.</Alert>}

      <div className="row wrap">
        <Button variant="primary" icon={Wallet} onClick={() => app.navigate('transactions')}>
          View transactions
        </Button>
        {report.needsReview > 0 && !undone && (
          <Button icon={ListFilter} onClick={() => app.navigate('category-finder')}>
            Categorize {report.needsReview.toLocaleString()} with Category Finder
          </Button>
        )}
        <Button onClick={onAnother}>Import another file</Button>
        {!undone && report.inserted > 0 && (
          <Button variant="outline-danger" icon={Undo2} loading={busy} onClick={() => void undo()}>
            Undo this import
          </Button>
        )}
      </div>
    </div>
  )
}
