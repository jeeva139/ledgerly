import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Paperclip, Trash2, X } from 'lucide-react'
import { DOCUMENT_MAX_BYTES, NEEDS_REVIEW, TRANSFER_CATEGORY, type Transaction } from '@shared/types'
import { isValidISODate, todayISO } from '@shared/dates'
import { useApp } from '@/app/AppContext'
import { ApiError, api, errorMessage } from '@/services/api'
import { useToast } from '@/components/Toasts'
import { useConfirm } from '@/components/Confirm'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Checkbox, Field, Input, MoneyInput, Segmented, Select, Textarea, parseMoney } from '@/components/form'
import { Alert } from '@/components/feedback'
import { CategorySelect } from '@/components/domain'
import { formatBytes } from '@/utils/misc'
import './transactions.css'

type Kind = 'expense' | 'income' | 'transfer'

interface EntryModalProps {
  mode: 'create' | 'edit'
  /** Required when mode is "edit". */
  transaction?: Transaction
  /** Create mode: values to pre-fill (e.g. extracted from a document). Never invented data. */
  prefill?: Record<string, unknown>
  onClose: () => void
  onSaved: () => void
}

/** Remembered for the rest of the session so repeated entries don't need the account re-picked. */
let lastAccount = ''

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function EntryModal({ mode, transaction, prefill, onClose, onSaved }: EntryModalProps) {
  const { boot, navigate } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const editing = mode === 'edit' && !!transaction
  const activeAccounts = boot.accounts.filter((a) => a.active)

  const initial = useMemo(() => {
    if (editing) {
      const t = transaction!
      return {
        kind: t.type as Kind,
        amount: String(t.amount),
        merchant: t.merchant,
        date: t.date,
        category: t.category,
        account: t.account,
        toAccount: '',
        tags: t.tags,
        memo: t.memo,
        isTransfer: t.isTransfer,
        documentId: null as string | null
      }
    }
    const p = prefill ?? {}
    const amountPref = typeof p.amount === 'number' && p.amount > 0 ? String(p.amount) : str(p.amount) ?? ''
    const datePref = str(p.date)
    const accountPref = str(p.account) ?? (activeAccounts.some((a) => a.name === lastAccount) ? lastAccount : activeAccounts[0]?.name ?? '')
    return {
      kind: (p.type === 'income' ? 'income' : 'expense') as Kind,
      amount: amountPref,
      merchant: str(p.merchant) ?? '',
      date: datePref && isValidISODate(datePref) ? datePref : todayISO(),
      category: str(p.category) ?? NEEDS_REVIEW,
      account: accountPref,
      toAccount: '',
      tags: Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      memo: '',
      isTransfer: false,
      documentId: str(p.documentId) ?? null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [kind, setKind] = useState<Kind>(initial.kind)
  const [amount, setAmount] = useState(initial.amount)
  const [merchant, setMerchant] = useState(initial.merchant)
  const [date, setDate] = useState(initial.date)
  const [category, setCategory] = useState(initial.category)
  const [account, setAccount] = useState(initial.account)
  const [toAccount, setToAccount] = useState(initial.toAccount)
  const [tags, setTags] = useState<string[]>(initial.tags)
  const [memo, setMemo] = useState(initial.memo)
  const [isTransfer, setIsTransfer] = useState(initial.isTransfer)
  const [file, setFile] = useState<File | null>(null)
  const [removeReceipt, setRemoveReceipt] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const formId = 'tx-entry-form'

  const isTransferKind = kind === 'transfer'
  const hasReceipt = editing && transaction!.receipt && !removeReceipt
  const title = editing ? 'Edit transaction' : 'Add entry'

  const accountOptions = useMemo(() => {
    const names = activeAccounts.map((a) => a.name)
    if (editing && account && !names.includes(account)) names.push(account)
    return names
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.accounts, account, editing])

  const chooseFile = (f: File | null) => {
    setErrors((e) => ({ ...e, receipt: '' }))
    if (!f) return setFile(null)
    if (f.size > DOCUMENT_MAX_BYTES) {
      setFile(null)
      setErrors((e) => ({ ...e, receipt: `“${f.name}” is ${formatBytes(f.size)}. Receipts can be at most 20 MB, so this file was not attached.` }))
      return
    }
    setFile(f)
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    const n = parseMoney(amount)
    if (n === null) e.amount = 'Enter an amount.'
    else if (!(n > 0)) e.amount = 'Amount must be greater than zero.'
    else if (n > 1e12) e.amount = 'Amount is too large.'
    if (!isValidISODate(date)) e.date = 'Please enter a valid date.'
    if (isTransferKind) {
      if (!account) e.account = 'Choose the account the money leaves.'
      if (!toAccount) e.toAccount = 'Choose the account the money goes to.'
      else if (toAccount === account) e.toAccount = 'A transfer needs two different accounts.'
    } else {
      if (!merchant.trim()) e.merchant = 'Merchant cannot be empty.'
      if (!isTransfer && !category) e.category = 'Choose a category.'
    }
    return e
  }

  const submit = async (allowDuplicate = false): Promise<void> => {
    const e = validate()
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    const amountValue = parseMoney(amount)!
    setSaving(true)
    try {
      if (!editing && isTransferKind) {
        await api.transactions.createTransfer({
          date, amount: amountValue, fromAccount: account, toAccount, memo: memo.trim() || undefined, allowDuplicate
        })
        toast.success('Transfer recorded. It is not counted as income or spending.')
      } else if (!editing) {
        const created = await api.transactions.create({
          date,
          merchant: merchant.trim(),
          memo: memo.trim() || undefined,
          category,
          amount: amountValue,
          type: kind as 'expense' | 'income',
          account: account || undefined,
          tags,
          receiptDocumentId: initial.documentId,
          allowDuplicate
        })
        if (file) await attachFile(created.id)
        toast.success('Transaction added.')
        if (account) lastAccount = account
      } else {
        const t = transaction!
        const patch: Record<string, unknown> = {
          date, merchant: merchant.trim(), memo: memo.trim(), amount: amountValue, type: kind as 'expense' | 'income', account: account || t.account, tags
        }
        if (isTransfer !== t.isTransfer) patch.isTransfer = isTransfer
        else if (!isTransfer && category !== t.category) patch.category = category
        await api.transactions.update({ id: t.id, patch, allowDuplicate })
        if (file) await attachFile(t.id)
        else if (removeReceipt && t.receipt) await api.transactions.attachReceipt({ id: t.id, documentId: null })
        toast.success('Transaction updated.')
      }
      onSaved()
      onClose()
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiError && err.code === 'DUPLICATE' && !allowDuplicate) {
        const again = await confirm({
          title: 'This looks like a duplicate',
          message: `${err.message}\n\nDo you want to save it anyway?`,
          confirmLabel: editing ? 'Save anyway' : 'Add anyway'
        })
        if (again) await submit(true)
        return
      }
      setFormError(errorMessage(err))
      return
    }
    setSaving(false)
  }

  /** The entry itself is already saved; a failed upload is reported without discarding it. */
  const attachFile = async (transactionId: string) => {
    try {
      const doc = await api.documents.uploadBytes({ filename: file!.name, bytes: new Uint8Array(await file!.arrayBuffer()), kind: 'receipt' })
      await api.transactions.attachReceipt({ id: transactionId, documentId: doc.id })
    } catch (err) {
      toast.error(`The transaction was saved, but the receipt could not be attached.\n${errorMessage(err)}`)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (!saving) void submit()
    }
  }

  const noAccounts = boot.accounts.length === 0
  const needTwoAccounts = isTransferKind && activeAccounts.length < 2

  return (
    <Modal
      title={title}
      size="md"
      dismissible={!saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={needTwoAccounts} title="Save (Ctrl+S)">
            {editing ? 'Save changes' : isTransferKind ? 'Record transfer' : 'Add entry'}
          </Button>
        </>
      }
    >
      <form id={formId} className="tx-entry stack" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} onKeyDown={onKeyDown}>
        {formError && <Alert kind="danger">{formError}</Alert>}

        <Segmented<Kind>
          label="Entry type"
          value={kind}
          onChange={(k) => {
            setKind(k)
            setErrors({})
          }}
          options={[
            { value: 'expense', label: 'Expense', className: 'expense' },
            { value: 'income', label: 'Income', className: 'income' },
            ...(editing ? [] : [{ value: 'transfer' as Kind, label: 'Transfer' }])
          ]}
        />

        {isTransferKind && (
          <Alert kind="info">A transfer moves money between your own accounts. It is never counted as income, spending or savings.</Alert>
        )}
        {noAccounts && (
          <Alert
            kind="warning"
            action={
              <Button size="sm" onClick={() => { onClose(); navigate('settings', { section: 'accounts' }) }}>
                Open Settings
              </Button>
            }
          >
            No accounts configured.{'\n'}Add an account in Settings before assigning transactions.
          </Alert>
        )}
        {needTwoAccounts && !noAccounts && <Alert kind="warning">Add at least two accounts in Settings to record a transfer.</Alert>}

        <div className="form-grid">
          <Field label="Amount" required error={errors.amount}>
            {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} placeholder="0.00" invalid={!!errors.amount} autoFocus={!editing} />}
          </Field>
          <Field label="Date" required error={errors.date}>
            {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />}
          </Field>

          {!isTransferKind && (
            <Field label="Merchant" required error={errors.merchant} className="full">
              {(p) => <Input {...p} value={merchant} maxLength={300} onChange={(e) => setMerchant(e.target.value)} placeholder="Who was this with?" invalid={!!errors.merchant} autoComplete="off" />}
            </Field>
          )}

          {isTransferKind ? (
            <>
              <Field label="From account" required error={errors.account}>
                {(p) => (
                  <Select {...p} value={account} onChange={(e) => setAccount(e.target.value)} invalid={!!errors.account}>
                    <option value="">Choose account…</option>
                    {accountOptions.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="To account" required error={errors.toAccount}>
                {(p) => (
                  <Select {...p} value={toAccount} onChange={(e) => setToAccount(e.target.value)} invalid={!!errors.toAccount}>
                    <option value="">Choose account…</option>
                    {accountOptions.filter((a) => a !== account).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label="Category" error={errors.category}>
                {(p) =>
                  isTransfer ? (
                    <Input {...p} value={TRANSFER_CATEGORY} disabled readOnly />
                  ) : (
                    <CategorySelect {...p} value={category} onChange={setCategory} allowCreate />
                  )
                }
              </Field>
              {!noAccounts && (
                <Field label="Account" error={errors.account}>
                  {(p) => (
                    <Select {...p} value={account} onChange={(e) => setAccount(e.target.value)}>
                      {!account && <option value="">Choose account…</option>}
                      {accountOptions.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </>
          )}

          <div className="field full">
            <span className="label" id="tx-tags-label">Tags</span>
            <TagEditor value={tags} onChange={setTags} known={boot.tags} />
          </div>

          <Field label="Memo (optional)" className="full" hint="Extra text kept with the transaction and searched by Category Finder.">
            {(p) => <Textarea {...p} rows={2} maxLength={2000} value={memo} onChange={(e) => setMemo(e.target.value)} />}
          </Field>

          {editing && (
            <div className="full">
              <Checkbox checked={isTransfer} onChange={setIsTransfer} label="This is a transfer between my own accounts (not income or spending)" />
            </div>
          )}

          {!isTransferKind && (
            <div className="field full">
              <span className="label">Receipt</span>
              <div className="tx-receipt">
                <Paperclip size={18} aria-hidden className="muted" />
                {file ? (
                  <>
                    <span className="grow truncate" title={file.name}>
                      {file.name} <span className="muted small">({formatBytes(file.size)})</span>
                    </span>
                    <Button size="sm" variant="ghost" icon={X} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = '' }}>
                      Remove
                    </Button>
                  </>
                ) : initial.documentId && !editing ? (
                  <span className="grow">The document you chose will be attached as the receipt.</span>
                ) : hasReceipt ? (
                  <>
                    <span className="grow">A receipt is attached.</span>
                    {transaction!.receiptDocId && (
                      <Button size="sm" onClick={() => void api.documents.open({ id: transaction!.receiptDocId! }).catch((err) => toast.error(errorMessage(err)))}>
                        Open
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoveReceipt(true)}>
                      Detach
                    </Button>
                  </>
                ) : (
                  <span className="grow muted">
                    {removeReceipt ? 'The receipt will be detached when you save.' : 'Optional. PDF or image, up to 20 MB, stored only on this computer.'}
                  </span>
                )}
                <Button size="sm" onClick={() => fileInput.current?.click()}>
                  {hasReceipt || file ? 'Replace…' : 'Attach receipt…'}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff"
                  aria-label="Receipt file"
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
              </div>
              {errors.receipt && (
                <div className="error" role="alert">
                  {errors.receipt}
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}

/** Tag pills + a text box: type a name and press Enter (or comma). A tag needs only a name. */
function TagEditor({ value, onChange, known }: { value: string[]; onChange: (tags: string[]) => void; known: string[] }) {
  const [text, setText] = useState('')
  const lower = new Set(value.map((t) => t.toLowerCase()))

  const add = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name || lower.has(name.toLowerCase())) return
    onChange([...value, known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name])
  }
  const suggestions = known.filter((k) => !lower.has(k.toLowerCase()) && k.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 10)

  return (
    <div>
      <div className="tx-tag-editor">
        {value.map((t) => (
          <span key={t} className="tag-pill">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <input
          aria-labelledby="tx-tags-label"
          value={text}
          maxLength={40}
          placeholder={value.length ? '' : 'Type a tag and press Enter'}
          onChange={(e) => setText(e.target.value.replace(',', ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              e.stopPropagation()
              add(text)
              setText('')
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => {
            if (text.trim()) {
              add(text)
              setText('')
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tx-tag-suggest" aria-label="Existing tags">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
