import { useState, type FormEvent } from 'react'
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import { ACCOUNT_TYPES, type Account, type AccountType } from '@shared/types'
import { Card } from '@/components/layout'
import { Button, IconButton } from '@/components/Button'
import { EmptyState, Pill } from '@/components/feedback'
import { Field, Input, MoneyInput, Select, Switch, parseMoney } from '@/components/form'
import { Modal } from '@/components/Modal'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'

const typeLabel = (t: AccountType) => ACCOUNT_TYPES.find((a) => a.id === t)?.label ?? t

function AccountDialog({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank')
  const [opening, setOpening] = useState(account?.openingBalance != null ? String(account.openingBalance) : '')
  const [active, setActive] = useState(account?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; opening?: string }>({})

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Enter a name for this account.'
    const openingValue = opening.trim() === '' ? null : parseMoney(opening)
    if (opening.trim() !== '' && openingValue === null) next.opening = 'Enter a number, or leave this blank.'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      if (account) await api.accounts.update({ id: account.id, name: name.trim(), type, openingBalance: openingValue, active })
      else await api.accounts.create({ name: name.trim(), type, openingBalance: openingValue, active })
      toast.success(account ? 'Account updated.' : 'Account added.')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={account ? 'Edit account' : 'Add account'}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving}>
            {account ? 'Save account' : 'Add account'}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={submit}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <Field label="Account name" required error={errors.name}>
          {(p) => <Input {...p} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary account" />}
        </Field>
        <Field label="Account type">
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Opening balance (optional)"
          error={errors.opening}
          hint="Leave this blank if you do not want to set one. Ledgerly never assumes a balance for you."
        >
          {(p) => <MoneyInput {...p} value={opening} onChange={setOpening} placeholder="Not set" />}
        </Field>
        <div className="row">
          <Switch checked={active} onChange={setActive} label="Account is active" />
          <span>Active — shown when choosing an account</span>
        </div>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  )
}

export function AccountsSection() {
  const { boot, refreshBoot, bump, fmt } = useApp()
  const confirm = useConfirm()
  const toast = useToast()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const accounts = boot.accounts

  const remove = async (a: Account) => {
    const ok = await confirm({
      title: `Remove “${a.name}”?`,
      message:
        'This removes the account from your list. Transactions already assigned to it keep their account name, and nothing is deleted.',
      confirmLabel: 'Remove account',
      danger: true
    })
    if (!ok) return
    try {
      await api.accounts.remove({ id: a.id })
      toast.success('Account removed.')
      await refreshBoot()
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card
      title="Accounts"
      actions={
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>
          Add account
        </Button>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        Accounts are the places your money moves through — bank accounts, cards, cash and wallets. They start with no balance.
      </p>
      {accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No accounts configured"
          compact
          action={
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Add account
            </Button>
          }
        >
          No accounts configured. Add an account in Settings before assigning transactions.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Opening balance
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 550 }}>{a.name}</td>
                  <td>{typeLabel(a.type)}</td>
                  <td className="num">{a.openingBalance === null ? <span className="faint">Not set</span> : fmt.money(a.openingBalance)}</td>
                  <td>{a.active ? <Pill tone="positive">Active</Pill> : <Pill>Inactive</Pill>}</td>
                  <td className="actions">
                    <IconButton icon={Pencil} label={`Edit ${a.name}`} onClick={() => setEditing(a)} />
                    <IconButton icon={Trash2} label={`Remove ${a.name}`} danger onClick={() => void remove(a)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void refreshBoot()
            bump()
          }}
        />
      )}
    </Card>
  )
}
