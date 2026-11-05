import { useMemo, useState, type FormEvent } from 'react'
import { FolderPlus, ListTree, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CategoryInfo } from '@shared/api'
import { CATEGORY_SEPARATOR, categoryLabel } from '@shared/types'
import { Card } from '@/components/layout'
import { Button, IconButton } from '@/components/Button'
import { Alert, ErrorState, Loading } from '@/components/feedback'
import { Field, Input, Select } from '@/components/form'
import { Modal } from '@/components/Modal'
import { CategoryLabel } from '@/components/domain'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api, ApiError, errorMessage } from '@/services/api'
import { plural } from '@/utils/misc'

const leafOf = (name: string) => name.slice(name.lastIndexOf(CATEGORY_SEPARATOR) + 1)
const parentOf = (name: string) => (name.includes(CATEGORY_SEPARATOR) ? name.slice(0, name.indexOf(CATEGORY_SEPARATOR)) : null)

interface Row {
  info: CategoryInfo
  sub: boolean
}

function AddDialog({ parents, presetParent, onClose, onDone }: { parents: string[]; presetParent: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [parent, setParent] = useState(presetParent ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Enter a name for the category.')
    if (name.includes(CATEGORY_SEPARATOR)) return setError(`Names cannot contain "${CATEGORY_SEPARATOR}". Use the parent menu to create a subcategory.`)
    setError(null)
    setSaving(true)
    try {
      await api.categories.add({ name: name.trim(), parent: parent || null })
      toast.success(parent ? 'Subcategory added.' : 'Category added.')
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      size="sm"
      title={presetParent ? `Add subcategory to ${presetParent}` : 'Add category'}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Add
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Name" required error={error}>
          {(p) => <Input {...p} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pets" />}
        </Field>
        <Field label="Parent category (optional)" hint="Choose one to create a subcategory.">
          {(p) => (
            <Select {...p} value={parent} onChange={(e) => setParent(e.target.value)} disabled={!!presetParent}>
              <option value="">None — top-level category</option>
              {parents.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Add
        </button>
      </form>
    </Modal>
  )
}

function RenameDialog({ info, onClose, onDone }: { info: CategoryInfo; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(leafOf(info.name))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isParent = !info.name.includes(CATEGORY_SEPARATOR)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Enter a name for the category.')
    if (name.trim() === leafOf(info.name)) return onClose()
    setSaving(true)
    setError(null)
    try {
      const res = await api.categories.rename({ from: info.name, newName: name.trim() })
      toast.success(`Renamed. ${plural(res.transactions, 'transaction')} updated.`)
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      size="sm"
      title={`Rename “${categoryLabel(info.name)}”`}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Rename
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="New name" required error={error}>
          {(p) => <Input {...p} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Alert kind="info">
          Renaming updates <strong>{plural(info.count, 'transaction')}</strong>
          {isParent ? ', its subcategories,' : ''} and any saved rules and budgets that use this category, so nothing is left behind under the old name.
        </Alert>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Rename
        </button>
      </form>
    </Modal>
  )
}

export function CategoriesSection() {
  const { refreshBoot, bump } = useApp()
  const confirm = useConfirm()
  const toast = useToast()
  const q = useQuery(() => api.categories.list(), [])
  const [adding, setAdding] = useState<{ parent: string | null } | null>(null)
  const [renaming, setRenaming] = useState<CategoryInfo | null>(null)

  const { rows, unmanaged, parents } = useMemo(() => {
    const all = q.data ?? []
    const managed = all.filter((c) => c.managed)
    const top = managed.filter((c) => !c.name.includes(CATEGORY_SEPARATOR))
    const out: Row[] = []
    for (const t of top) {
      out.push({ info: t, sub: false })
      for (const c of managed) if (parentOf(c.name) === t.name) out.push({ info: c, sub: true })
    }
    // Subcategories whose parent is not (or no longer) managed.
    for (const c of managed) if (c.name.includes(CATEGORY_SEPARATOR) && !out.some((r) => r.info.name === c.name)) out.push({ info: c, sub: true })
    return { rows: out, unmanaged: all.filter((c) => !c.managed).sort((a, b) => b.count - a.count), parents: top.map((t) => t.name) }
  }, [q.data])

  const changed = () => {
    q.reload()
    void refreshBoot()
    bump()
  }

  const remove = async (c: CategoryInfo) => {
    const ok = await confirm({
      title: `Remove “${categoryLabel(c.name)}” from your list?`,
      message:
        `${plural(c.count, 'transaction')} currently use this category. They keep the label “${categoryLabel(c.name)}” — Ledgerly never rewrites past transactions when you remove a category.` +
        (c.name.includes(CATEGORY_SEPARATOR) ? '' : '\n\nIts subcategories are removed from the list as well.'),
      confirmLabel: 'Remove from list',
      danger: true
    })
    if (!ok) return
    try {
      await api.categories.remove({ name: c.name })
      toast.success('Category removed from your list.')
      changed()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const adopt = async (c: CategoryInfo) => {
    try {
      const parent = parentOf(c.name)
      if (parent) {
        try {
          await api.categories.add({ name: parent })
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'DUPLICATE')) throw e
        }
        await api.categories.add({ name: leafOf(c.name), parent })
      } else {
        await api.categories.add({ name: c.name })
      }
      toast.success('Added to your category list.')
      changed()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Card
        title="Categories"
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding({ parent: null })}>
            Add category
          </Button>
        }
      >
        <p className="muted" style={{ marginBottom: 12 }}>
          Categories group your transactions. A category can have subcategories, such as Food › Dining.
        </p>
        {q.error && !q.data ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : q.loading && !q.data ? (
          <Loading label="Loading categories…" />
        ) : (
          <div className="table-wrap">
            <table className="table cat-tree">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">
                    Transactions
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ info, sub }) => (
                  <tr key={info.name} className={sub ? 'sub' : ''}>
                    <td>
                      <div className="cat-name">
                        <CategoryLabel name={sub ? leafOf(info.name) : info.name} />
                        {info.system && (
                          <span className="pill" title="Ledgerly relies on this category, so it cannot be renamed or removed.">
                            <Lock size={11} aria-hidden /> Built in
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{info.count.toLocaleString()}</td>
                    <td className="actions">
                      {!sub && <IconButton icon={FolderPlus} label={`Add a subcategory to ${info.name}`} onClick={() => setAdding({ parent: info.name })} />}
                      <IconButton icon={Pencil} label={`Rename ${categoryLabel(info.name)}`} disabled={info.system} onClick={() => setRenaming(info)} />
                      <IconButton icon={Trash2} label={`Remove ${categoryLabel(info.name)}`} danger disabled={info.system} onClick={() => void remove(info)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {unmanaged.length > 0 && (
        <Card title="Labels on past transactions that are not in your list">
          <p className="muted" style={{ marginBottom: 12 }}>
            These labels come from earlier transactions (for example an imported file, or a category you removed). They are kept exactly as they are. Add one to your list to
            pick it for new transactions.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col" className="num">
                    Transactions
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {unmanaged.map((c) => (
                  <tr key={c.name}>
                    <td>
                      <CategoryLabel name={c.name} />
                    </td>
                    <td className="num">{c.count.toLocaleString()}</td>
                    <td className="actions">
                      <Button size="sm" icon={ListTree} onClick={() => void adopt(c)}>
                        Add to my list
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {adding && <AddDialog parents={parents} presetParent={adding.parent} onClose={() => setAdding(null)} onDone={changed} />}
      {renaming && <RenameDialog info={renaming} onClose={() => setRenaming(null)} onDone={changed} />}
    </>
  )
}
