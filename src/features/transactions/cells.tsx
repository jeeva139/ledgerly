import { useEffect, useRef, useState } from 'react'
import { Paperclip, Plus, X } from 'lucide-react'
import { NEEDS_REVIEW, categoryLabel, type Transaction } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'
import { useToast } from '@/components/Toasts'
import { Modal } from '@/components/Modal'
import { Button, IconButton } from '@/components/Button'
import { Field, Input } from '@/components/form'
import { Pill } from '@/components/feedback'
import { categoryColor } from '@/utils/colors'
import { TagPopover } from './TagPopover'
import './transactions.css'

const CREATE = '__create__'

/** Inline category editor: always visible, change it and it is saved to SQLite immediately. */
export function CategoryCell({ row }: { row: Transaction }) {
  const { boot, bump, refreshBoot } = useApp()
  const toast = useToast()
  const [value, setValue] = useState(row.category)
  const [creating, setCreating] = useState(false)
  useEffect(() => setValue(row.category), [row.category])

  if (row.isTransfer) {
    return (
      <Pill tone="info" title="Transfers are not counted as income or spending">
        Transfer
      </Pill>
    )
  }

  const options = boot.categories.includes(value) ? boot.categories : [...boot.categories, value]

  const save = async (category: string, createIfMissing = false) => {
    const previous = value
    setValue(category)
    try {
      await api.transactions.setCategory({ selection: { ids: [row.id] }, category, createIfMissing })
      bump()
    } catch (e) {
      setValue(previous)
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <span className="tx-cat">
        <span className="cat-dot" style={{ background: categoryColor(value) }} aria-hidden />
        <select
          className={`tx-cat-select${value === NEEDS_REVIEW ? ' needs' : ''}`}
          aria-label={`Category for ${row.merchant}`}
          value={value}
          onChange={(e) => (e.target.value === CREATE ? setCreating(true) : void save(e.target.value))}
        >
          {options.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
          <option value={CREATE}>＋ Create new category…</option>
        </select>
      </span>
      {creating && (
        <NewCategoryModal
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const list = await api.categories.add({ name })
            await refreshBoot()
            const created = list.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name
            await save(created)
            setCreating(false)
          }}
        />
      )}
    </>
  )
}

function NewCategoryModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) {
      setError('Enter a category name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(name.trim())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      size="sm"
      title="Create a category"
      subtitle="It will be assigned to this transaction."
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Create and assign
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Category name" error={error}>
          {(p) => <Input {...p} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pets" />}
        </Field>
      </form>
    </Modal>
  )
}

/** Tag pills with remove buttons and a "+" that opens the tag-only picker. */
export function TagCell({ row }: { row: Transaction }) {
  const { boot, bump } = useApp()
  const toast = useToast()
  const [tags, setTags] = useState(row.tags)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => setTags(row.tags), [row.tags])

  const save = async (next: string[]) => {
    const previous = tags
    setTags(next)
    try {
      const updated = await api.transactions.setTags({ id: row.id, tags: next })
      setTags(updated.tags)
      bump()
    } catch (e) {
      setTags(previous)
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="tx-tags">
      {tags.map((t) => (
        <span key={t} className="tag-pill">
          {t}
          <button type="button" aria-label={`Remove tag ${t} from ${row.merchant}`} title={`Remove ${t}`} onClick={() => void save(tags.filter((x) => x !== t))}>
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
      <button ref={btn} type="button" className="tag-add" aria-label={`Add tag to ${row.merchant}`} title="Add tag" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus size={12} aria-hidden />
      </button>
      {open && btn.current && (
        <TagPopover
          anchor={btn.current}
          allTags={boot.tags}
          selected={tags}
          mode="toggle"
          title="Tags for this transaction"
          onClose={() => setOpen(false)}
          onPick={(name, on) =>
            void save(on ? [...tags.filter((t) => t.toLowerCase() !== name.toLowerCase()), name] : tags.filter((t) => t.toLowerCase() !== name.toLowerCase()))
          }
        />
      )}
    </div>
  )
}

export function ReceiptCell({ row }: { row: Transaction }) {
  const toast = useToast()
  if (!row.receipt) return <span className="sr-only">No receipt</span>
  if (!row.receiptDocId) {
    return (
      <span title="A receipt is recorded for this transaction" className="muted">
        <Paperclip size={16} aria-label="Receipt recorded" />
      </span>
    )
  }
  return (
    <IconButton
      icon={Paperclip}
      size="sm"
      label={`Open receipt for ${row.merchant}`}
      onClick={() => void api.documents.open({ id: row.receiptDocId! }).catch((e) => toast.error(errorMessage(e)))}
    />
  )
}
