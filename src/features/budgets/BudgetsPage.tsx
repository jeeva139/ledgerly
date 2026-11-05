import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, PauseCircle, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react'
import { addMonths, todayISO } from '@shared/dates'
import type { BudgetProgress, BudgetState } from '@shared/api/planning'
import { useApp } from '@/app/AppContext'
import { Button, IconButton } from '@/components/Button'
import { CategoryLabel, CategorySelect } from '@/components/domain'
import { Alert, EmptyState, ErrorState, Loading, ProgressBar } from '@/components/feedback'
import { Checkbox, Field, MoneyInput, Switch, parseMoney } from '@/components/form'
import { Card, PageHeader, StatCard } from '@/components/layout'
import { Modal } from '@/components/Modal'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { categoryLabel } from '@shared/types'
import './budgets.css'

const monthLabel = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const shiftMonth = (month: string, by: number) => addMonths(`${month}-01`, by).slice(0, 7)

const STATE_META: Record<BudgetState, { label: string; tone: 'positive' | 'warning' | 'danger' | undefined; icon: typeof CheckCircle2 }> = {
  'on-track': { label: 'On track', tone: 'positive', icon: CheckCircle2 },
  'near-limit': { label: 'Near limit', tone: 'warning', icon: AlertTriangle },
  over: { label: 'Over budget', tone: 'danger', icon: AlertOctagon },
  inactive: { label: 'Paused', tone: undefined, icon: PauseCircle }
}

function StatePill({ state }: { state: BudgetState }) {
  const m = STATE_META[state]
  const Icon = m.icon
  return (
    <span className={`pill ${m.tone ?? ''}`}>
      <Icon size={13} aria-hidden />
      {m.label}
    </span>
  )
}

export function BudgetsPage() {
  const { fmt, bump } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const thisMonth = todayISO().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [editing, setEditing] = useState<BudgetProgress | 'new' | null>(null)

  const q = useQuery(() => api.budgets.list({ month }), [month])
  const budgets = q.data?.budgets ?? []
  const health = q.data?.health

  const toggleActive = async (b: BudgetProgress, active: boolean) => {
    try {
      await api.budgets.update({ id: b.id, active })
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const remove = async (b: BudgetProgress) => {
    const ok = await confirm({
      title: 'Delete this budget?',
      message: `The budget for ${categoryLabel(b.category)} will be removed. Your transactions are not affected.`,
      confirmLabel: 'Delete budget',
      danger: true
    })
    if (!ok) return
    try {
      await api.budgets.delete({ id: b.id })
      toast.success('Budget deleted.')
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Budgets"
        subtitle="Set a monthly limit for a category and see how much you have actually spent. Spending comes from your own transactions; transfers are not counted."
        actions={
          <>
            <div className="month-nav" role="group" aria-label="Month">
              <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
              <span className="month-label" aria-live="polite">{monthLabel(month)}</span>
              <IconButton icon={ChevronRight} label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
            </div>
            {month !== thisMonth && (
              <Button size="sm" onClick={() => setMonth(thisMonth)}>
                This month
              </Button>
            )}
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Create Budget
            </Button>
          </>
        }
      />

      {q.loading && !q.data ? (
        <Loading label="Loading budgets…" />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="No budgets yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                Create Budget
              </Button>
            }
          >
            Create your first budget to start tracking spending.
          </EmptyState>
        </Card>
      ) : (
        <>
          {health && (
            <div className="grid cols-4" aria-label="Budget health summary">
              <StatCard label="Budgeted" tone="accent" icon={PiggyBank} value={fmt.money(health.totalLimit)} hint={`${health.activeCount} active ${health.activeCount === 1 ? 'budget' : 'budgets'}`} />
              <StatCard
                label="Spent"
                tone="spending"
                icon={AlertTriangle}
                value={fmt.money(health.totalSpent)}
                hint={health.totalLimit > 0 ? `${Math.round((health.totalSpent / health.totalLimit) * 100)}% of the budgeted amount` : undefined}
              />
              <StatCard
                label={health.totalSpent > health.totalLimit ? 'Over by' : 'Remaining'}
                tone={health.totalSpent > health.totalLimit ? 'spending' : 'positive'}
                icon={CheckCircle2}
                value={fmt.money(Math.abs(health.totalLimit - health.totalSpent))}
                hint="Across active budgets"
              />
              <Card>
                <div className="stat">
                  <div className="label">Budget health</div>
                  <div className="health-states">
                    <span className="pill positive">{health.onTrack} on track</span>
                    <span className="pill warning">{health.nearLimit} near limit</span>
                    <span className="pill danger">{health.over} over</span>
                  </div>
                  <div className="hint">Near limit means 80% or more is used.</div>
                </div>
              </Card>
            </div>
          )}

          <div className="budget-grid">
            {budgets.map((b) => {
              const tone = b.state === 'over' ? 'danger' : b.state === 'near-limit' ? 'spending' : 'positive'
              return (
                <article key={b.id} className={`card budget-card${b.state === 'inactive' ? ' inactive' : ''}`} aria-label={`Budget for ${categoryLabel(b.category)}`}>
                  <div className="row between">
                    <div className="budget-title truncate">
                      <CategoryLabel name={b.category} />
                    </div>
                    <div className="row" style={{ gap: 2 }}>
                      <Switch checked={b.active} onChange={(v) => void toggleActive(b, v)} label={`Budget for ${categoryLabel(b.category)} is active`} />
                      <IconButton icon={Pencil} label={`Edit budget for ${categoryLabel(b.category)}`} onClick={() => setEditing(b)} />
                      <IconButton icon={Trash2} danger label={`Delete budget for ${categoryLabel(b.category)}`} onClick={() => void remove(b)} />
                    </div>
                  </div>
                  <div className="budget-figures">
                    <span className="spent">{fmt.money(b.spent)}</span>
                    <span className="muted">of {fmt.money(b.monthlyLimit)} limit</span>
                  </div>
                  <ProgressBar value={Math.min(b.spent, b.monthlyLimit)} max={b.monthlyLimit} tone={b.state === 'inactive' ? undefined : tone} label={`${b.percent}% of the ${categoryLabel(b.category)} budget used`} />
                  <div className="budget-meta">
                    <span>
                      <strong>{b.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong> used
                    </span>
                    <StatePill state={b.state} />
                    <span className={b.remaining < 0 ? 'neg' : 'muted'}>
                      {b.remaining < 0 ? `Over by ${fmt.money(-b.remaining)}` : `${fmt.money(b.remaining)} remaining`}
                    </span>
                  </div>
                  <div className="small muted">
                    Spent: {b.transactionCount.toLocaleString()} {b.transactionCount === 1 ? 'transaction' : 'transactions'} in {monthLabel(b.month)}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      {editing && (
        <BudgetModal
          budget={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            bump()
          }}
        />
      )}
    </div>
  )
}

function BudgetModal({ budget, onClose, onSaved }: { budget: BudgetProgress | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [category, setCategory] = useState(budget?.category ?? '')
  const [limit, setLimit] = useState(budget ? String(budget.monthlyLimit) : '')
  const [active, setActive] = useState(budget?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    const value = parseMoney(limit)
    if (!category) return setError('Choose a category for this budget.')
    if (value === null || value <= 0) return setError('Enter a monthly limit greater than zero.')
    setSaving(true)
    setError(null)
    try {
      if (budget) await api.budgets.update({ id: budget.id, category, monthlyLimit: value, active })
      else await api.budgets.create({ category, monthlyLimit: value, active })
      toast.success(budget ? 'Budget updated.' : 'Budget created.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Modal
      title={budget ? 'Edit budget' : 'Create budget'}
      subtitle="Limits apply to each calendar month."
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {budget ? 'Save changes' : 'Create budget'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        {error && <Alert kind="danger">{error}</Alert>}
        <Field label="Category" required hint="A budget on a category also counts its subcategories.">
          {(p) => <CategorySelect {...p} value={category} onChange={setCategory} allowCreate emptyLabel="Choose a category…" />}
        </Field>
        <Field label="Monthly limit" required>
          {(p) => <MoneyInput {...p} value={limit} onChange={setLimit} placeholder="0.00" />}
        </Field>
        <Checkbox checked={active} onChange={setActive} label="Active (included in the budget health summary)" />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
