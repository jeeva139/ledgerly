import { useState, type FormEvent } from 'react'
import { Plus, Tags as TagsIcon, Trash2 } from 'lucide-react'
import type { TagUsage } from '@shared/types'
import { Card } from '@/components/layout'
import { Button, IconButton } from '@/components/Button'
import { EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Input } from '@/components/form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { plural } from '@/utils/misc'

function DeleteTagDialog({ tag, onClose, onDone }: { tag: TagUsage; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'remove' | 'keep' | null>(null)

  const run = async (removeFromTransactions: boolean) => {
    setBusy(removeFromTransactions ? 'remove' : 'keep')
    try {
      const res = await api.tags.delete({ name: tag.name, removeFromTransactions })
      toast.success(removeFromTransactions ? `Tag deleted and removed from ${plural(res.removedFrom, 'transaction')}.` : 'Tag deleted. Past transactions keep it.')
      onDone()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <Modal
      size="sm"
      title={`Delete the tag “${tag.name}”?`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={() => void run(false)} loading={busy === 'keep'} disabled={!!busy && busy !== 'keep'}>
            Keep on transactions
          </Button>
          <Button variant="danger" onClick={() => void run(true)} loading={busy === 'remove'} disabled={!!busy && busy !== 'remove'}>
            Remove from transactions too
          </Button>
        </>
      }
    >
      <div className="stack">
        <strong>Remove this tag from historical transactions too?</strong>
        <p className="muted">
          {tag.count > 0 ? `${plural(tag.count, 'transaction')} currently use this tag.` : 'No transactions use this tag right now.'} Choose what happens to them:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Remove from transactions too</strong> — the tag disappears everywhere.
          </li>
          <li>
            <strong>Keep on transactions</strong> — the tag leaves your list, but past transactions still show it.
          </li>
        </ul>
      </div>
    </Modal>
  )
}

export function TagsSection() {
  const { refreshBoot, bump } = useApp()
  const toast = useToast()
  const q = useQuery(() => api.tags.list(), [])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TagUsage | null>(null)

  const add = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Enter a tag name.')
    setError(null)
    setSaving(true)
    try {
      await api.tags.create({ name: name.trim() })
      setName('')
      toast.success('Tag added.')
      q.reload()
      void refreshBoot()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const changed = () => {
    q.reload()
    void refreshBoot()
    bump()
  }

  return (
    <Card title="Tags">
      <p className="muted" style={{ marginBottom: 12 }}>
        Tags are free-form labels (like Weekend or Family) that work alongside categories. A tag only needs a name.
      </p>
      <form className="row wrap" onSubmit={add} style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <Input aria-label="New tag name" placeholder="New tag name" value={name} maxLength={40} invalid={!!error} onChange={(e) => setName(e.target.value)} />
          {error && (
            <div className="small" style={{ color: 'var(--danger-text)', marginTop: 4 }} role="alert">
              {error}
            </div>
          )}
        </div>
        <Button type="submit" variant="primary" icon={Plus} loading={saving}>
          Add tag
        </Button>
      </form>

      {q.error && !q.data ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : q.loading && !q.data ? (
        <Loading label="Loading tags…" />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={TagsIcon} title="No tags yet" compact>
          Add a tag above, or create one while editing a transaction.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col" className="num">
                  Usage count
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((t) => (
                <tr key={t.name}>
                  <td>
                    <span className="tag-pill" style={{ paddingRight: 9 }}>
                      {t.name}
                    </span>
                  </td>
                  <td className="num">{t.count.toLocaleString()}</td>
                  <td className="actions">
                    <IconButton icon={Trash2} label={`Delete tag ${t.name}`} danger onClick={() => setDeleting(t)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleting && <DeleteTagDialog tag={deleting} onClose={() => setDeleting(null)} onDone={changed} />}
    </Card>
  )
}
