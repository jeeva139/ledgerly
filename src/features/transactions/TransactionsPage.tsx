import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, Download, FileSpreadsheet, FileText, FileType2, Import, Pencil, SearchX, Tag, Trash2, Wallet, X
} from 'lucide-react'
import { PERIODS, categoryLabel, type Transaction } from '@shared/types'
import { periodRange } from '@shared/dates'
import type { ExportFormat, TransactionFilters, TransactionSelection, TxnSort, TxnSortField } from '@shared/api/transactions'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'
import { useQuery } from '@/hooks/useQuery'
import { useToast } from '@/components/Toasts'
import { useConfirm } from '@/components/Confirm'
import { Button, IconButton } from '@/components/Button'
import { Field, Input, Select } from '@/components/form'
import { Card, PageHeader, Pagination } from '@/components/layout'
import { EmptyState, ErrorState, Loading, Pill } from '@/components/feedback'
import { CategorySelect, Money } from '@/components/domain'
import { plural } from '@/utils/misc'
import { CategoryCell, ReceiptCell, TagCell } from './cells'
import { EntryModal } from './EntryModal'
import { TagPopover } from './TagPopover'
import './transactions.css'

// ---------------------------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------------------------

interface Filters {
  account: string
  category: string
  tag: string
  type: 'all' | 'expense' | 'income'
  transfers: 'all' | 'exclude' | 'only'
  needsReview: boolean
  /** Custom dates override the global period when either is set. */
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { account: '', category: '', tag: '', type: 'all', transfers: 'all', needsReview: false, from: '', to: '' }

const s = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** `navigate('transactions', params)` may carry filters (e.g. a dashboard link to "Needs review"). */
function filtersFromParams(p: Record<string, unknown>): Partial<Filters> {
  const out: Partial<Filters> = {}
  if (s(p.account)) out.account = s(p.account)
  if (s(p.category)) out.category = s(p.category)
  if (s(p.tag)) out.tag = s(p.tag)
  if (p.type === 'expense' || p.type === 'income') out.type = p.type
  if (p.transfers === 'exclude' || p.transfers === 'only') out.transfers = p.transfers
  if (p.needsReview === true) out.needsReview = true
  if (s(p.dateFrom)) out.from = s(p.dateFrom)
  if (s(p.dateTo)) out.to = s(p.dateTo)
  return out
}

/** State that resets itself whenever `key` changes (used for page number and row selection). */
function useScoped<T>(key: string, empty: T) {
  const [state, setState] = useState<{ key: string; value: T }>({ key, value: empty })
  const value = state.key === key ? state.value : empty
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setState((prev) => {
        const base = prev.key === key ? prev.value : empty
        return { key, value: typeof next === 'function' ? (next as (p: T) => T)(base) : next }
      }),
    [key, empty]
  )
  return [value, set] as const
}

interface Selection {
  /** "ids": `ids` are the selected rows. "all": every row matching the filters, except `ids`. */
  mode: 'ids' | 'all'
  ids: ReadonlySet<string>
}
const EMPTY_SELECTION: Selection = { mode: 'ids', ids: new Set() }
const DEFAULT_SORT: TxnSort = { field: 'date', dir: 'desc' }
const MAX_ID_SELECTION = 5000

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function TransactionsPage() {
  const app = useApp()
  const { boot, fmt, period, search, setSearch, navigate, openAddEntry, bump, route } = app
  const toast = useToast()
  const confirm = useConfirm()

  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, ...filtersFromParams(route.params) }))
  const [pageSize, setPageSize] = useState(100)
  const [sort, setSort] = useState<TxnSort>(DEFAULT_SORT)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const tagBtn = useRef<HTMLButtonElement>(null)

  // Filters passed through navigation after the page is already open.
  const firstParams = useRef(true)
  useEffect(() => {
    if (firstParams.current) {
      firstParams.current = false
      if (typeof route.params.search === 'string') setSearch(route.params.search)
      return
    }
    const p = route.params
    if (Object.keys(p).length === 0) return
    setFilters((f) => ({ ...EMPTY_FILTERS, ...f, ...filtersFromParams(p) }))
    if (typeof p.search === 'string') setSearch(p.search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params])

  const customRange = !!(filters.from || filters.to)
  const range = useMemo(() => (customRange ? { from: filters.from || null, to: filters.to || null } : periodRange(period)), [customRange, filters.from, filters.to, period])

  const apiFilters = useMemo<TransactionFilters>(
    () => ({
      search: search.trim() || undefined,
      dateFrom: range.from,
      dateTo: range.to,
      accounts: filters.account ? [filters.account] : undefined,
      categories: filters.category ? [filters.category] : undefined,
      tags: filters.tag ? [filters.tag] : undefined,
      type: filters.type,
      transfers: filters.transfers,
      needsReview: filters.needsReview || undefined
    }),
    [search, range, filters]
  )
  const filtersKey = JSON.stringify(apiFilters)

  const [page, setPage] = useScoped(filtersKey, 1)
  const [selection, setSelection] = useScoped<Selection>(filtersKey, EMPTY_SELECTION)

  const options = useQuery(() => api.transactions.listFilterOptions(), [])
  const result = useQuery(
    () => api.transactions.list({ ...apiFilters, page, pageSize, sort }),
    [filtersKey, page, pageSize, sort.field, sort.dir]
  )

  const rows = result.data?.rows ?? []
  const total = result.data?.total ?? 0
  const totals = result.data?.totals

  const hasActiveFilters =
    JSON.stringify({ ...filters, from: '', to: '' }) !== JSON.stringify({ ...EMPTY_FILTERS, from: '', to: '' }) || !!search.trim() || customRange
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setSearch('')
  }
  const patchFilters = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  // ---- sorting ----
  const onSort = (field: TxnSortField) =>
    setSort((cur) => (cur.field === field ? { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'date' || field === 'amount' ? 'desc' : 'asc' }))

  // ---- selection ----
  const isSelected = (id: string) => (selection.mode === 'ids' ? selection.ids.has(id) : !selection.ids.has(id))
  const selectedCount = selection.mode === 'ids' ? selection.ids.size : Math.max(0, total - selection.ids.size)
  const pageIds = rows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every(isSelected)
  const someOnPage = pageIds.some(isSelected)

  const toggleRow = (id: string) => {
    if (selection.mode === 'ids' && !selection.ids.has(id) && selection.ids.size >= MAX_ID_SELECTION) {
      toast.error(`You can pick up to ${MAX_ID_SELECTION.toLocaleString()} rows by hand. Use “Select all matching” for larger selections.`)
      return
    }
    setSelection((s0) => {
      const ids = new Set(s0.ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { mode: s0.mode, ids }
    })
  }
  const toggleAllOnPage = () =>
    setSelection((s0) => {
      const ids = new Set(s0.ids)
      const select = !pageIds.every((id) => (s0.mode === 'ids' ? ids.has(id) : !ids.has(id)))
      for (const id of pageIds) {
        // "ids" mode: add/remove from the selected set. "all" mode: remove/add to the excluded set.
        if (s0.mode === 'ids' ? select : !select) ids.add(id)
        else ids.delete(id)
      }
      return { mode: s0.mode, ids }
    })
  const clearSelection = () => setSelection(EMPTY_SELECTION)

  const buildSelection = (): TransactionSelection =>
    selection.mode === 'ids' ? { ids: [...selection.ids] } : { filters: apiFilters, exceptIds: [...selection.ids] }

  const runBulk = async (opts: { confirmTitle?: string; confirmMessage?: string; confirmLabel?: string; danger?: boolean }, action: () => Promise<string>) => {
    if (opts.confirmTitle) {
      const ok = await confirm({ title: opts.confirmTitle, message: opts.confirmMessage, confirmLabel: opts.confirmLabel, danger: opts.danger })
      if (!ok) return
    }
    try {
      const message = await action()
      toast.success(message)
      clearSelection()
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const n = selectedCount
  const bulkSetCategory = (category: string) =>
    runBulk(
      n > 1 ? { confirmTitle: `Set category to ${categoryLabel(category)}?`, confirmMessage: `This changes ${plural(n, 'transaction')} and locks the category so rules won’t overwrite it.`, confirmLabel: 'Apply' } : {},
      async () => {
        const r = await api.transactions.setCategory({ selection: buildSelection(), category })
        return `Categorised ${plural(r.updated, 'transaction')} as ${categoryLabel(r.category)}.`
      }
    )
  const bulkAddTag = (tag: string) =>
    runBulk({}, async () => {
      const r = await api.transactions.addTags({ selection: buildSelection(), tags: [tag] })
      return r.updated === 0 ? `Those transactions already have the tag “${tag}”.` : `Added “${tag}” to ${plural(r.updated, 'transaction')}.`
    })
  const bulkTransfer = (isTransfer: boolean) =>
    runBulk(
      { confirmTitle: isTransfer ? 'Mark as transfers?' : 'Unmark transfers?', confirmMessage: isTransfer ? `${plural(n, 'transaction')} will no longer count as income or spending.` : `${plural(n, 'transaction')} will count as income or spending again.`, confirmLabel: isTransfer ? 'Mark as transfers' : 'Unmark' },
      async () => {
        const r = await api.transactions.markTransfer({ selection: buildSelection(), isTransfer })
        return `${plural(r.updated, 'transaction')} updated.`
      }
    )
  const bulkDelete = () =>
    runBulk(
      { confirmTitle: `Delete ${plural(n, 'transaction')}?`, confirmMessage: 'This permanently removes them from Ledgerly. It cannot be undone.', confirmLabel: 'Delete', danger: true },
      async () => {
        const r = await api.transactions.deleteMany({ selection: buildSelection() })
        return `Deleted ${plural(r.deleted, 'transaction')}.`
      }
    )

  // ---- row actions ----
  const deleteRow = async (row: Transaction) => {
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: `${row.merchant}\n${fmt.date(row.date)} · ${fmt.money(row.amount)}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.transactions.delete({ id: row.id })
      toast.success('Transaction deleted.')
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const toggleTransfer = async (row: Transaction) => {
    try {
      await api.transactions.markTransfer({ selection: { ids: [row.id] }, isTransfer: !row.isTransfer })
      toast.success(row.isTransfer ? 'No longer a transfer.' : 'Marked as a transfer. It is not counted as income or spending.')
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------

  const empty = boot.counts.transactions === 0
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? ''

  return (
    <div className="page">
      <PageHeader
        title="Transactions"
        subtitle="Search, review and categorise every transaction. Changes are saved to your local database immediately."
        actions={
          <>
            <Button icon={Import} onClick={() => navigate('import')}>
              Import
            </Button>
            <ExportMenu filters={apiFilters} disabled={empty || total === 0} />
          </>
        }
      />

      {empty ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No transactions yet"
            action={
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <Button variant="primary" icon={Import} onClick={() => navigate('import')}>
                  Import a statement
                </Button>
                <Button onClick={() => openAddEntry()}>Add your first transaction</Button>
              </div>
            }
          >
            Import a bank statement or add your first transaction.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <div className="stack">
              <div className="tx-filters" role="group" aria-label="Filters">
                <Field label="Account">
                  {(p) => (
                    <Select {...p} small value={filters.account} onChange={(e) => patchFilters({ account: e.target.value })}>
                      <option value="">All accounts</option>
                      {(options.data?.accounts ?? []).map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Category">
                  {(p) => (
                    <Select {...p} small value={filters.category} onChange={(e) => patchFilters({ category: e.target.value })}>
                      <option value="">All categories</option>
                      {(options.data?.categories ?? []).map((c) => (
                        <option key={c} value={c}>{categoryLabel(c)}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Tag">
                  {(p) => (
                    <Select {...p} small value={filters.tag} onChange={(e) => patchFilters({ tag: e.target.value })}>
                      <option value="">All tags</option>
                      {(options.data?.tags ?? []).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Type" className="narrow">
                  {(p) => (
                    <Select {...p} small value={filters.type} onChange={(e) => patchFilters({ type: e.target.value as Filters['type'] })}>
                      <option value="all">Income &amp; expenses</option>
                      <option value="expense">Expenses only</option>
                      <option value="income">Income only</option>
                    </Select>
                  )}
                </Field>
                <Field label="Transfers" className="narrow">
                  {(p) => (
                    <Select {...p} small value={filters.transfers} onChange={(e) => patchFilters({ transfers: e.target.value as Filters['transfers'] })}>
                      <option value="all">Include transfers</option>
                      <option value="exclude">Hide transfers</option>
                      <option value="only">Only transfers</option>
                    </Select>
                  )}
                </Field>
                <Field label="From date" className="narrow">
                  {(p) => <Input {...p} small type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => patchFilters({ from: e.target.value })} />}
                </Field>
                <Field label="To date" className="narrow">
                  {(p) => <Input {...p} small type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => patchFilters({ to: e.target.value })} />}
                </Field>
                <div className="tx-filter-actions">
                  <Button size="sm" aria-pressed={filters.needsReview} variant={filters.needsReview ? 'primary' : 'default'} onClick={() => patchFilters({ needsReview: !filters.needsReview })}>
                    Needs review
                  </Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={clearFilters} disabled={!hasActiveFilters}>
                    Clear filters
                  </Button>
                </div>
              </div>
              <div className="tx-period-note">
                {customRange ? (
                  <Pill tone="accent">Custom dates</Pill>
                ) : period !== 'all-time' ? (
                  <Pill tone="accent">{periodLabel}</Pill>
                ) : (
                  <Pill>All time</Pill>
                )}
                <span>
                  {customRange ? 'Custom dates override the period chosen at the top.' : 'Period follows the selector at the top of the window.'}
                  {search.trim() && <> Searching for “{search.trim()}”.</>}
                </span>
              </div>
            </div>
          </Card>

          {totals && (
            <div className="tx-totals" aria-label="Totals for the filtered transactions">
              <div className="tx-total">
                <div className="k">Income</div>
                <div className="v pos">{fmt.money(totals.income)}</div>
                <div className="s">Transfers excluded</div>
              </div>
              <div className="tx-total">
                <div className="k">Spending</div>
                <div className="v neg">{fmt.money(totals.expense)}</div>
                <div className="s">Transfers excluded</div>
              </div>
              <div className="tx-total">
                <div className="k">Net</div>
                <div className={`v ${totals.income - totals.expense >= 0 ? 'pos' : 'neg'}`}>{fmt.money(totals.income - totals.expense, { sign: true })}</div>
                <div className="s">Income − spending</div>
              </div>
              <div className="tx-total">
                <div className="k">Transactions</div>
                <div className="v">{total.toLocaleString()}</div>
                <div className="s">{hasActiveFilters || period !== 'all-time' ? 'matching the filters' : 'in total'}</div>
              </div>
            </div>
          )}

          {selectedCount > 0 && (
            <div className="tx-bulk" role="region" aria-label="Bulk actions">
              <span className="count">{plural(selectedCount, 'transaction')} selected</span>
              {selection.mode === 'ids' && allOnPage && total > rows.length && (
                <button type="button" className="link" onClick={() => setSelection({ mode: 'all', ids: new Set() })}>
                  Select all {total.toLocaleString()} matching
                </button>
              )}
              {selection.mode === 'all' && <span className="muted small">Everything matching the current filters{selection.ids.size > 0 ? ` (${selection.ids.size} left out)` : ''}</span>}
              <span className="grow" />
              <div className="cat-pick">
                <CategorySelect small value="" emptyLabel="Set category…" allowCreate onChange={(c) => void bulkSetCategory(c)} aria-label="Set category for selected transactions" />
              </div>
              <Button ref={tagBtn} size="sm" icon={Tag} onClick={() => setTagPickerOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={tagPickerOpen}>
                Add tag
              </Button>
              <Button size="sm" icon={ArrowLeftRight} onClick={() => void bulkTransfer(true)}>
                Mark as transfer
              </Button>
              <Button size="sm" onClick={() => void bulkTransfer(false)}>
                Not a transfer
              </Button>
              <Button size="sm" variant="outline-danger" icon={Trash2} onClick={() => void bulkDelete()}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
              {tagPickerOpen && tagBtn.current && (
                <TagPopover
                  anchor={tagBtn.current}
                  allTags={boot.tags}
                  mode="add"
                  title="Add a tag to the selected transactions"
                  onClose={() => setTagPickerOpen(false)}
                  onPick={(name) => void bulkAddTag(name)}
                />
              )}
            </div>
          )}

          <Card flush>
            {result.error && !result.data ? (
              <ErrorState message={result.error} onRetry={result.reload} />
            ) : !result.data ? (
              <Loading label="Loading transactions…" />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No transactions match these filters"
                action={
                  <Button onClick={clearFilters} disabled={!hasActiveFilters}>
                    Clear filters
                  </Button>
                }
              >
                {period !== 'all-time' && !customRange ? `Nothing was found for “${periodLabel}”. Try another period or loosen the filters.` : 'Try loosening the filters or searching for something else.'}
              </EmptyState>
            ) : (
              <div className="table-wrap tx-table-wrap" aria-busy={result.loading}>
                <table className="table tx-table" style={{ opacity: result.loading ? 0.65 : 1 }}>
                  <thead>
                    <tr>
                      <th className="check-col">
                        <input
                          type="checkbox"
                          aria-label="Select all transactions on this page"
                          checked={allOnPage}
                          ref={(el) => {
                            if (el) el.indeterminate = someOnPage && !allOnPage
                          }}
                          onChange={toggleAllOnPage}
                        />
                      </th>
                      <SortTh field="date" label="Date" sort={sort} onSort={onSort} />
                      <SortTh field="merchant" label="Merchant" sort={sort} onSort={onSort} />
                      <SortTh field="category" label="Category" sort={sort} onSort={onSort} />
                      <SortTh field="account" label="Account" sort={sort} onSort={onSort} className="tx-col-account" />
                      <th>Tags</th>
                      <SortTh field="amount" label="Amount" sort={sort} onSort={onSort} className="num" />
                      <SortTh field="type" label="Type" sort={sort} onSort={onSort} className="tx-col-type" />
                      <th>Receipt</th>
                      <th className="actions">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={isSelected(row.id) ? 'selected' : undefined}>
                        <td className="check-col">
                          <input type="checkbox" aria-label={`Select ${row.merchant} on ${fmt.date(row.date)}`} checked={isSelected(row.id)} onChange={() => toggleRow(row.id)} />
                        </td>
                        <td className="nowrap">{fmt.date(row.date)}</td>
                        <td className="tx-merchant">
                          <div className="tx-merchant-main" title={row.merchant}>{row.merchant}</div>
                          {row.memo && <div className="tx-merchant-sub" title={row.memo}>{row.memo}</div>}
                          <div className="tx-acct-inline">{row.account}</div>
                        </td>
                        <td><CategoryCell row={row} /></td>
                        <td className="tx-col-account">{row.account}</td>
                        <td><TagCell row={row} /></td>
                        <td className="num">
                          {row.isTransfer ? (
                            <span className="num muted" title="Transfer — not counted as income or spending">{fmt.money(row.amount)}</span>
                          ) : (
                            <Money amount={row.amount} type={row.type} />
                          )}
                        </td>
                        <td className="tx-col-type">
                          {row.isTransfer ? <Pill tone="info">Transfer</Pill> : row.type === 'income' ? <Pill tone="positive">Income</Pill> : <Pill tone="spending">Expense</Pill>}
                        </td>
                        <td><ReceiptCell row={row} /></td>
                        <td className="actions">
                          <IconButton icon={Pencil} size="sm" label={`Edit ${row.merchant}`} onClick={() => setEditing(row)} />
                          <IconButton icon={ArrowLeftRight} size="sm" label={row.isTransfer ? `Unmark ${row.merchant} as a transfer` : `Mark ${row.merchant} as a transfer`} onClick={() => void toggleTransfer(row)} />
                          <IconButton icon={Trash2} size="sm" danger label={`Delete ${row.merchant}`} onClick={() => void deleteRow(row)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.data && total > 0 && (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPage={setPage}
                onPageSize={(sz) => {
                  setPageSize(sz)
                  setPage(1)
                }}
              />
            )}
          </Card>
        </>
      )}

      {editing && <EntryModal mode="edit" transaction={editing} onClose={() => setEditing(null)} onSaved={bump} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

function SortTh({ field, label, sort, onSort, className = '' }: { field: TxnSortField; label: string; sort: TxnSort; onSort: (f: TxnSortField) => void; className?: string }) {
  const active = sort.field === field
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort" onClick={() => onSort(field)} title={`Sort by ${label.toLowerCase()}`}>
        {label}
        {active ? sort.dir === 'asc' ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden /> : <ArrowUpDown size={13} aria-hidden className="faint" />}
      </button>
    </th>
  )
}

/** Export the current (filtered) view to CSV, Excel or QIF through a native Save dialog. */
function ExportMenu({ filters, disabled }: { filters: TransactionFilters; disabled?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = async (format: ExportFormat) => {
    setBusy(format)
    setOpen(false)
    try {
      const r = await api.transactions.export({ format, filters })
      if (r.saved) toast.success(`Exported ${plural(r.count, 'transaction')} to ${r.fileName}.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const items: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
    { format: 'csv', label: 'CSV (.csv)', icon: FileText },
    { format: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
    { format: 'qif', label: 'QIF (.qif)', icon: FileType2 }
  ]

  return (
    <div className="tx-menu-wrap" ref={wrap}>
      <Button icon={Download} loading={busy !== null} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Export the transactions that match the current filters">
        Export
      </Button>
      {open && (
        <div className="tx-menu" role="menu" aria-label="Export format">
          {items.map(({ format, label, icon: Icon }) => (
            <button key={format} role="menuitem" type="button" className="menu-item" onClick={() => void run(format)}>
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
          <div className="hint small muted" style={{ padding: '6px 10px 4px' }}>
            Exports what the filters show. Saved on this computer only.
          </div>
        </div>
      )}
    </div>
  )
}
