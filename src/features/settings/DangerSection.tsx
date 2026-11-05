import { useState, type FormEvent } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { Card } from '@/components/layout'
import { Button } from '@/components/Button'
import { Alert } from '@/components/feedback'
import { Checkbox, Field, Input } from '@/components/form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'

const WORD = 'DELETE'

function EraseDialog({ onClose }: { onClose: () => void }) {
  const { refreshBoot, bump } = useApp()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const [safety, setSafety] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed === WORD

  const erase = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!matches) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.data.eraseAll({ confirmation: typed, safetyBackup: safety })
      toast.success(res.safetyBackupName ? `All data erased. A safety backup was saved as ${res.safetyBackupName}.` : 'All Ledgerly data was erased.')
      await refreshBoot()
      bump()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Erase all Ledgerly data"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!matches} loading={busy} onClick={() => void erase()}>
            DELETE EVERYTHING
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={erase}>
        <Alert kind="danger">
          <strong>This will permanently delete:</strong>
          <ul className="delete-list">
            <li>Transactions</li>
            <li>Accounts</li>
            <li>Categories</li>
            <li>Tags</li>
            <li>Rules</li>
            <li>Budgets</li>
            <li>Goals</li>
            <li>Recurring items</li>
            <li>Subscriptions</li>
            <li>Documents</li>
            <li>Imported data</li>
          </ul>
          <div style={{ marginTop: 8 }}>
            <strong>This action cannot be undone.</strong>
          </div>
        </Alert>
        <Checkbox
          checked={safety}
          onChange={setSafety}
          disabled={busy}
          label="Save a safety backup first (recommended). It stays in the Ledgerly backups folder and is not deleted."
        />
        <Field label="Type DELETE to confirm" error={error} hint="Capital letters, exactly as shown.">
          {(p) => (
            <Input
              {...p}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={WORD}
            />
          )}
        </Field>
        <div className="small muted">
          Backup files you made earlier and files you exported are separate files in their own folders. Erasing does not touch them.
        </div>
        <button type="submit" className="sr-only" tabIndex={-1} disabled={!matches}>
          Erase
        </button>
      </form>
    </Modal>
  )
}

export function DangerSection() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Card title="Danger zone" className="danger-card">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <TriangleAlert size={20} aria-hidden style={{ color: 'var(--danger)', flex: 'none', marginTop: 2 }} />
            <div>
              <strong>Erase all Ledgerly data</strong>
              <p className="muted" style={{ marginTop: 4 }}>
                Permanently removes every transaction, account, category, tag, rule, budget, goal, document and setting, and returns Ledgerly to a brand-new, empty state.
                Consider creating a backup first.
              </p>
            </div>
          </div>
          <div>
            <Button variant="outline-danger" icon={Trash2} onClick={() => setOpen(true)}>
              Erase all Ledgerly data…
            </Button>
          </div>
        </div>
      </Card>
      {open && <EraseDialog onClose={() => setOpen(false)} />}
    </>
  )
}
