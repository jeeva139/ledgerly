import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileSpreadsheet, FileText, FileType2, HelpCircle, ListOrdered, TrendingDown, TrendingUp, X, XCircle } from 'lucide-react'
import type { ImportProgressEvent } from '@shared/api'
import type { ImportOptions, ImportPreview, ImportReport, ImportSessionSummary } from '@shared/api/imports'
import { ACCOUNT_TYPES, type AccountType } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Alert, Loading, ProgressBar } from '@/components/feedback'
import { Checkbox, Field, Input, Segmented, Select } from '@/components/form'
import { Card, StatCard } from '@/components/layout'
import { useToast } from '@/components/Toasts'
import { api, errorMessage, events } from '@/services/api'
import { formatBytes } from '@/utils/misc'
import { MappingPanel } from './MappingPanel'
import { PreviewTable } from './PreviewTable'

interface Props {
  summary: ImportSessionSummary
  onCancel: () => void
  onDone: (report: ImportReport) => void
}

const NEW_ACCOUNT = '__new__'
const FORMAT_ICON = { qif: FileText, csv: FileType2, excel: FileSpreadsheet }
const FORMAT_LABEL = { qif: 'QIF', csv: 'CSV', excel: 'Excel' }

export function ReviewStep({ summary, onCancel, onDone }: Props) {
  const app = useApp()
  const { fmt } = app
  const toast = useToast()
  const sessionId = summary.sessionId

  const accounts = app.boot.accounts.filter((a) => a.active)
  const [options, setOptions] = useState<ImportOptions>(summary.defaults)
  const [acctChoice, setAcctChoice] = useState<string>(summary.defaults.account?.name ?? '')
  const [newName, setNewName] = useState(summary.qif?.accountNames[0] ?? '')
  const [newType, setNewType] = useState<AccountType>('bank')

  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null)
  const reqId = useRef(0)

  const patch = (p: Partial<ImportOptions>) => setOptions((o) => ({ ...o, ...p }))

  const effective = useMemo<ImportOptions>(() => {
    let account: ImportOptions['account'] = null
    if (acctChoice === NEW_ACCOUNT) account = newName.trim() ? { name: newName.trim(), type: newType } : null
    else if (acctChoice) account = { name: acctChoice }
    return { ...options, account }
  }, [options, acctChoice, newName, newType])
  const key = JSON.stringify(effective)

  useEffect(() => events.on('import:progress', (p) => {
    const e = p as ImportProgressEvent
    if (e.sessionId === sessionId) setProgress(e)
  }), [sessionId])

  // Recompute the preview whenever an option changes (debounced). Nothing is written to the database.
  useEffect(() => {
    const id = ++reqId.current
    setBusy(true)
    const t = window.setTimeout(
      () => {
        api.import
          .preview({ sessionId, options: effective })
          .then((p) => {
            if (id !== reqId.current) return
            setPreview(p)
            setError(null)
            setBusy(false)
          })
          .catch((e) => {
            if (id !== reqId.current) return
            setError(errorMessage(e))
            setBusy(false)
          })
      },
      preview ? 250 : 0
    )
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessionId])

  const cancel = async () => {
    await api.import.cancel({ sessionId }).catch(() => undefined)
    onCancel()
  }

  const doImport = async () => {
    setImporting(true)
    setProgress(null)
    setError(null)
    try {
      const report = await api.import.commit({ sessionId, options: effective })
      app.bump()
      onDone(report)
    } catch (e) {
      setImporting(false)
      setError(errorMessage(e))
      toast.error(errorMessage(e))
    }
  }

  // Ctrl+S confirms the import when it is ready.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && preview?.canImport && !busy && !importing) {
        e.preventDefault()
        void doImport()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  if (importing) {
    const total = progress?.phase === 'importing' ? progress.total : (preview?.newCount ?? 0)
    const done = progress?.phase === 'importing' ? progress.done : 0
    return (
      <div className="imp-progress" role="status" aria-live="polite">
        <h2>Importing…</h2>
        <div className="count">
          {done.toLocaleString()} / {total.toLocaleString()}
        </div>
        <ProgressBar value={done} max={Math.max(1, total)} label="Import progress" />
        <p className="muted small">Please keep Ledgerly open. Large files are saved in safe batches.</p>
      </div>
    )
  }

  const FormatIcon = FORMAT_ICON[summary.format]
  const table = preview?.table ?? summary.table
  const dateNeedsChoice = !!preview?.dateAmbiguous && (options.dateFormat ?? 'auto') === 'auto'
  const orderLabel = preview?.dateOrder === 'MDY' ? 'month/day/year' : 'day/month/year'

  return (
    <div className="stack lg">
      <Card>
        <div className="imp-file">
          <span className="imp-file-icon">
            <FormatIcon size={22} aria-hidden />
          </span>
          <div className="grow">
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 className="truncate" style={{ maxWidth: '100%' }}>{summary.filename}</h2>
              <span className="pill accent">{FORMAT_LABEL[summary.format]}</span>
            </div>
            <div className="muted small">{formatBytes(summary.size)} · read on this computer only</div>
          </div>
          <Button icon={X} onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      </Card>

      {error && <Alert kind="danger">{error}</Alert>}
      {summary.notes.map((n) => (
        <Alert key={n} kind="info">{n}</Alert>
      ))}

      {preview ? (
        <div className="imp-summary" aria-busy={busy}>
          <StatCard label="Transactions detected" icon={ListOrdered} tone="accent" value={preview.detected.toLocaleString()} hint={`${preview.valid.toLocaleString()} readable`} />
          <StatCard label="Income" icon={TrendingUp} tone="positive" value={fmt.money(preview.incomeTotal)} hint={`${preview.incomeCount.toLocaleString()} transactions`} />
          <StatCard label="Expenses" icon={TrendingDown} tone="spending" value={fmt.money(preview.expenseTotal)} hint={`${preview.expenseCount.toLocaleString()} transactions`} />
          <StatCard label="Potential duplicates" icon={Copy} tone="info" value={preview.duplicates.toLocaleString()} hint="Already in Ledgerly — skipped" />
          <StatCard label="Needs review" icon={HelpCircle} tone="spending" value={preview.needsReview.toLocaleString()} hint="No category yet" />
          <StatCard label="Invalid / skipped" icon={XCircle} tone="info" value={preview.invalid.toLocaleString()} hint="Could not be read" />
        </div>
      ) : (
        !error && <Loading label="Reading the file…" />
      )}

      {preview && preview.transferCount > 0 && (
        <Alert kind="info">
          {preview.transferCount.toLocaleString()} transfer{preview.transferCount === 1 ? '' : 's'} between accounts will be imported but not counted as income or spending.
        </Alert>
      )}
      {preview?.signHint && <Alert kind="warning">{preview.signHint}</Alert>}
      {preview?.notes.map((n) => (
        <Alert key={n} kind="info">{n}</Alert>
      ))}

      <Card title="Import settings">
        <div className="imp-options">
          <Field label="Account" required hint="The account these transactions belong to.">
            {(p) => (
              <>
                <Select {...p} value={acctChoice} onChange={(e) => setAcctChoice(e.target.value)} invalid={!acctChoice || (acctChoice === NEW_ACCOUNT && !newName.trim())}>
                  <option value="">Choose an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                  <option value={NEW_ACCOUNT}>＋ New account…</option>
                </Select>
                {acctChoice === NEW_ACCOUNT && (
                  <div className="imp-new-account">
                    <Input aria-label="New account name" placeholder="Account name" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
                    <Select aria-label="Account type" value={newType} onChange={(e) => setNewType(e.target.value as AccountType)}>
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </>
            )}
          </Field>

          <Field
            label="Date format"
            error={dateNeedsChoice ? 'The dates in this file could be read either way. Choose how they are written.' : null}
            hint={!dateNeedsChoice && preview?.dateOrder ? `Dates are read as ${orderLabel}.` : undefined}
          >
            {(p) => (
              <Select {...p} value={options.dateFormat ?? 'auto'} onChange={(e) => patch({ dateFormat: e.target.value as ImportOptions['dateFormat'] })}>
                <option value="auto">Detect automatically</option>
                <option value="DMY">Day / Month / Year (31/12/2026)</option>
                <option value="MDY">Month / Day / Year (12/31/2026)</option>
              </Select>
            )}
          </Field>

          <div className="field">
            <span className="label">Amount sign</span>
            <Segmented
              label="Amount sign convention"
              value={options.signConvention ?? 'normal'}
              onChange={(v) => patch({ signConvention: v })}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'reverse', label: 'Reverse' }
              ]}
            />
            <div className="hint">
              {options.signConvention === 'reverse'
                ? 'Reversed: positive amounts are expenses and negative amounts are income.'
                : 'Normal: negative amounts are expenses and positive amounts are income.'}
            </div>
          </div>

          {summary.table && summary.table.sheets.length > 1 && (
            <Field label="Sheet" hint="The worksheet to read.">
              {(p) => (
                <Select {...p} value={options.sheet ?? preview?.table?.sheet ?? summary.table?.sheet ?? ''} onChange={(e) => patch({ sheet: e.target.value, mapping: undefined, headerRow: null })}>
                  {summary.table!.sheets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div className="field full">
            <Checkbox
              checked={!!options.addNewCategories}
              onChange={(v) => patch({ addNewCategories: v })}
              label="Add new categories from the file to my category list"
            />
            {preview && preview.newCategories.length > 0 && (
              <div className="imp-chips" aria-label="New categories found in the file">
                {preview.newCategories.slice(0, 12).map((c) => (
                  <span key={c} className="pill accent">{c}</span>
                ))}
                {preview.newCategories.length > 12 && <span className="pill">+{preview.newCategories.length - 12} more</span>}
              </div>
            )}
            <Checkbox
              checked={!!options.rulesOverrideImported}
              onChange={(v) => patch({ rulesOverrideImported: v })}
              label="Let my saved rules replace categories that come from the file"
            />
            <div className="hint">By default a category that is already in the file is kept; saved rules only fill in the gaps.</div>
          </div>
        </div>
        {preview && preview.newAccounts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Alert kind="info">
              Accounts named in the file that do not exist yet will be created: <strong>{preview.newAccounts.join(', ')}</strong>.
            </Alert>
          </div>
        )}
        {preview?.account && !preview.account.exists && (
          <div style={{ marginTop: 12 }}>
            <Alert kind="info">
              The account <strong>{preview.account.name}</strong> will be created when you import.
            </Alert>
          </div>
        )}
      </Card>

      {table && summary.format !== 'qif' && <MappingPanel table={table} options={effective} onChange={patch} />}

      {preview && preview.detected > 0 && <PreviewTable preview={preview} busy={busy} />}

      <div className="imp-footer">
        <div className="small muted" role="status">
          {busy
            ? 'Checking…'
            : preview && preview.blockers.length > 0
              ? preview.blockers[0]
              : preview
                ? `${preview.newCount.toLocaleString()} new · ${preview.duplicates.toLocaleString()} duplicates skipped · ${preview.invalid.toLocaleString()} unreadable`
                : ''}
        </div>
        <div className="row">
          <Button onClick={() => void cancel()}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!preview?.canImport || busy}
            title={preview && preview.blockers.length ? preview.blockers.join(' ') : 'Import the new transactions (Ctrl+S)'}
            onClick={() => void doImport()}
          >
            Import Transactions
          </Button>
        </div>
      </div>
    </div>
  )
}
