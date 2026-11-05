import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import type { RecategorizePreview } from '@shared/api/rules'
import { api, errorMessage } from '@/services/api'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Alert } from '@/components/feedback'
import { Checkbox } from '@/components/form'
import { CategoryLabel } from '@/components/domain'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'

interface Props {
  onClose: () => void
}

/**
 * Explicit bulk re-categorisation with the saved rules: choose scope → preview (changes nothing) → confirm → apply.
 */
export function BulkRecategorizeModal({ onClose }: Props) {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [includeCategorized, setIncludeCategorized] = useState(false)
  const [includeLocked, setIncludeLocked] = useState(false)
  const [preview, setPreview] = useState<RecategorizePreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = { includeCategorized, includeLocked }
  const changeOption = (fn: () => void) => {
    fn()
    setPreview(null) // the previous preview no longer matches the options
  }

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    try {
      setPreview(await api.rules.recategorizePreview(options))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const runApply = async () => {
    if (!preview) return
    const ok = await confirm({
      title: `Recategorize ${preview.wouldChange.toLocaleString()} ${preview.wouldChange === 1 ? 'transaction' : 'transactions'}?`,
      message: 'Saved rules will change the category of the transactions in the preview. Amounts, dates, merchants and accounts are not touched.',
      confirmLabel: 'Recategorize'
    })
    if (!ok) return
    setBusy('apply')
    try {
      const { changed } = await api.rules.recategorizeApply(options)
      toast.success(`Recategorized ${changed.toLocaleString()} ${changed === 1 ? 'transaction' : 'transactions'}.`)
      app.bump()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <Modal
      size="lg"
      title="Bulk recategorize"
      subtitle="Re-run your saved rules over transactions you already have. Nothing changes until you confirm."
      onClose={onClose}
      dismissible={busy === null}
      footer={
        <>
          <Button onClick={onClose} disabled={busy !== null}>
            Close
          </Button>
          <Button icon={Wand2} onClick={() => void runPreview()} loading={busy === 'preview'} disabled={busy === 'apply'}>
            {preview ? 'Preview again' : 'Preview changes'}
          </Button>
          <Button
            variant="primary"
            loading={busy === 'apply'}
            disabled={!preview || preview.wouldChange === 0 || busy === 'preview'}
            onClick={() => void runApply()}
          >
            Apply to {preview ? preview.wouldChange.toLocaleString() : '…'} {preview?.wouldChange === 1 ? 'transaction' : 'transactions'}
          </Button>
        </>
      }
    >
      <div className="stack lg">
        <div className="recat-options">
          <div>
            <p className="muted">By default only transactions in <strong>Needs review</strong> are considered, and categories you chose yourself are never overwritten. Transfers are never changed.</p>
          </div>
          <Checkbox
            checked={includeCategorized}
            onChange={(v) => changeOption(() => setIncludeCategorized(v))}
            label="Also re-evaluate transactions that already have a category"
          />
          <Checkbox
            checked={includeLocked}
            onChange={(v) => changeOption(() => setIncludeLocked(v))}
            label="Include manually categorized transactions"
          />
          {includeLocked && <div className="hint" style={{ color: 'var(--warning-text)' }}>Rules may overwrite categories you set by hand.</div>}
        </div>

        {error && <Alert kind="danger">{error}</Alert>}

        {preview && preview.rulesEnabled === 0 && (
          <Alert kind="warning">There are no enabled rules, so nothing can be recategorized. Create or enable a rule first.</Alert>
        )}

        {preview && preview.rulesEnabled > 0 && (
          <div className="stack" aria-live="polite">
            <Alert kind={preview.wouldChange > 0 ? 'info' : 'success'}>
              <strong>
                {preview.wouldChange === 0
                  ? 'No transactions would change.'
                  : `${preview.wouldChange.toLocaleString()} ${preview.wouldChange === 1 ? 'transaction' : 'transactions'} would change.`}
              </strong>
              {'\n'}
              Checked {preview.scanned.toLocaleString()} transactions with {preview.rulesEnabled.toLocaleString()} enabled {preview.rulesEnabled === 1 ? 'rule' : 'rules'}.
              {preview.skippedLocked > 0 && ` ${preview.skippedLocked.toLocaleString()} manually categorized left alone.`}
              {preview.skippedCategorized > 0 && ` ${preview.skippedCategorized.toLocaleString()} already categorized left alone.`}
            </Alert>

            {preview.byCategory.length > 0 && (
              <div className="stack sm">
                <h3>New categories</h3>
                <div className="row wrap">
                  {preview.byCategory.map((c) => (
                    <span key={c.category} className="pill accent">
                      <CategoryLabel name={c.category} /> · {c.count.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {preview.samples.length > 0 && (
              <div className="stack sm">
                <h3>Examples{preview.wouldChange > preview.samples.length ? ` (first ${preview.samples.length})` : ''}</h3>
                <div className="table-wrap" style={{ maxHeight: 280 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Transaction</th>
                        <th scope="col">Change</th>
                        <th scope="col">Rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.samples.map((s) => (
                        <tr key={s.id}>
                          <td className="nowrap">{app.fmt.date(s.date)}</td>
                          <td className="recat-sample-text">{s.text.length > 120 ? `${s.text.slice(0, 120)}…` : s.text}</td>
                          <td>
                            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              <CategoryLabel name={s.from} />
                              <span aria-hidden>→</span>
                              <strong>
                                <CategoryLabel name={s.to} />
                              </strong>
                            </span>
                          </td>
                          <td className="mono">{s.rule}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
