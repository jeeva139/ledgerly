import { useState } from 'react'
import { Plus } from 'lucide-react'
import { categoryLabel, NEEDS_REVIEW, type TxnType } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'
import { categoryColor } from '@/utils/colors'
import { Button } from './Button'
import { Input, Select } from './form'
import { useToast } from './Toasts'

/** Signed, colour-coded amount (sign is always printed, so colour is never the only cue). */
export function Money({ amount, type, className = '' }: { amount: number; type?: TxnType; className?: string }) {
  const { fmt } = useApp()
  if (!type) return <span className={`num ${className}`}>{fmt.money(amount)}</span>
  const income = type === 'income'
  return (
    <span className={`num ${income ? 'pos' : 'neg'} ${className}`}>
      {income ? '+' : '−'}
      {fmt.money(amount)}
    </span>
  )
}

export function CategoryLabel({ name }: { name: string }) {
  return (
    <span className="cat-chip" title={categoryLabel(name)}>
      <span className="cat-dot" style={{ background: categoryColor(name) }} aria-hidden />
      <span className="truncate">{categoryLabel(name)}</span>
    </span>
  )
}

export function NeedsReviewPill() {
  return <span className="pill warning">{NEEDS_REVIEW}</span>
}

const CREATE_VALUE = '__create__'

interface CategorySelectProps {
  value: string
  onChange: (category: string) => void
  id?: string
  small?: boolean
  /** Offer "Create new category…" at the end of the list. */
  allowCreate?: boolean
  /** Extra first option such as "All categories" (value ''). */
  emptyLabel?: string
  disabled?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/** Managed category picker. Subcategories show as "Parent › Child". Optionally creates a new category inline. */
export function CategorySelect({ value, onChange, id, small, allowCreate, emptyLabel, disabled, ...aria }: CategorySelectProps) {
  const { boot, refreshBoot } = useApp()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const options = [...boot.categories]
  if (value && !options.includes(value)) options.push(value) // keep historical labels selectable

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const list = await api.categories.add({ name: name.trim() })
      await refreshBoot()
      const created = list.find((c) => c.toLowerCase() === name.trim().toLowerCase()) ?? name.trim()
      onChange(created)
      setCreating(false)
      setName('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <Input
          small={small}
          autoFocus
          placeholder="New category name"
          aria-label="New category name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setCreating(false)
            }
          }}
        />
        <Button size="sm" variant="primary" loading={busy} onClick={() => void create()} disabled={!name.trim()}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Select
      id={id}
      small={small}
      value={value}
      disabled={disabled}
      onChange={(e) => (e.target.value === CREATE_VALUE ? setCreating(true) : onChange(e.target.value))}
      {...aria}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((c) => (
        <option key={c} value={c}>
          {categoryLabel(c)}
        </option>
      ))}
      {allowCreate && <option value={CREATE_VALUE}>＋ Create new category…</option>}
    </Select>
  )
}

export function AddButtonIcon() {
  return <Plus size={16} aria-hidden />
}
