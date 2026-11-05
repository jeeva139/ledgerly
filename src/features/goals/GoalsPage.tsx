import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Coins, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import type { GoalProgress, GoalStatus } from '@shared/api/planning'
import { useApp } from '@/app/AppContext'
import { Button, IconButton } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading, ProgressBar } from '@/components/feedback'
import { Field, Input, MoneyInput, Textarea, parseMoney } from '@/components/form'
import { Card, PageHeader, StatCard } from '@/components/layout'
import { Modal } from '@/components/Modal'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import './goals.css'

const STATUS_META: Record<GoalStatus, { label: string; tone: 'positive' | 'warning' | 'danger' | 'accent' | undefined }> = {
  completed: { label: 'Goal reached', tone: 'positive' },
  overdue: { label: 'Overdue', tone: 'danger' },
  'due-soon': { label: 'Due soon', tone: 'warning' },
  active: { label: 'In progress', tone: 'accent' }
}

function dueText(g: GoalProgress, formatDate: (iso: string) => string): string {
  if (!g.dueDate) return 'No due date'
  const date = formatDate(g.dueDate)
  if (g.completed) return `Due ${date}`
  const d = g.daysLeft ?? 0
  if (d < 0) return `Due ${date} · overdue by ${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'}`
  if (d === 0) return `Due today (${date})`
  return `Due ${date} · ${d} ${d === 1 ? 'day' : 'days'} left`
}

export function GoalsPage() {
  const { fmt, bump } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<GoalProgress | 'new' | null>(null)
  const [updatingSaved, setUpdatingSaved] = useState<GoalProgress | null>(null)

  const q = useQuery(() => api.goals.list(), [])
  const goals = q.data ?? []

  const remove = async (g: GoalProgress) => {
    const ok = await confirm({
      title: 'Delete this goal?',
      message: `"${g.name}" will be removed. This does not change any transactions.`,
      confirmLabel: 'Delete goal',
      danger: true
    })
    if (!ok) return
    try {
      await api.goals.delete({ id: g.id })
      toast.success('Goal deleted.')
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const completed = goals.filter((g) => g.completed).length
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0)
  const totalSaved = goals.reduce((s, g) => s + Math.min(g.currentAmount, g.targetAmount), 0)

  return (
    <div className="page">
      <PageHeader
        title="Goals"
        subtitle="Track what you are saving towards. The saved amount is whatever you enter — Ledgerly never guesses it from your transactions."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New Goal
          </Button>
        }
      />

      {q.loading && !q.data ? (
        <Loading label="Loading goals…" />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No goals yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                New Goal
              </Button>
            }
          >
            Create a financial goal to track your progress.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid cols-3">
            <StatCard icon={Target} tone="accent" label="Goals" value={goals.length.toLocaleString()} hint={`${completed} reached`} />
            <StatCard icon={Coins} tone="positive" label="Saved so far" value={fmt.money(totalSaved)} hint="Across all goals" />
            <StatCard icon={Clock} tone="info" label="Total target" value={fmt.money(totalTarget)} hint="Across all goals" />
          </div>

          <div className="goal-grid">
            {goals.map((g) => {
              const meta = STATUS_META[g.status]
              return (
                <article key={g.id} className="card goal-card" aria-label={`Goal: ${g.name}`}>
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <div className="goal-title">{g.name}</div>
                    <span className={`pill ${meta.tone ?? ''}`}>
                      {g.status === 'completed' ? <CheckCircle2 size={13} aria-hidden /> : g.status === 'overdue' ? <AlertTriangle size={13} aria-hidden /> : null}
                      {meta.label}
                    </span>
                  </div>
                  {g.note && <div className="goal-note">{g.note}</div>}
                  <div className="goal-figures">
                    <div>
                      <div className="figure-label">Saved</div>
                      <div className="figure-value">{fmt.money(g.currentAmount)}</div>
                    </div>
                    <div>
                      <div className="figure-label">Target</div>
                      <div className="figure-value">{fmt.money(g.targetAmount)}</div>
                    </div>
                    <div>
                      <div className="figure-label">Remaining</div>
                      <div className="figure-value">{fmt.money(g.remaining)}</div>
                    </div>
                  </div>
                  <ProgressBar value={Math.min(g.currentAmount, g.targetAmount)} max={g.targetAmount} tone={g.completed ? 'positive' : g.status === 'overdue' ? 'danger' : undefined} label={`${g.name}: ${g.percent}% of the target saved`} />
                  <div className="goal-foot">
                    <span>
                      <strong>{g.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong> of target
                    </span>
                    <span className="muted">{dueText(g, fmt.date)}</span>
                  </div>
                  <div className="goal-actions">
                    <Button size="sm" icon={Coins} onClick={() => setUpdatingSaved(g)} aria-label={`Update saved amount for ${g.name}`}>
                      Update saved
                    </Button>
                    <span className="grow" />
                    <IconButton icon={Pencil} label={`Edit ${g.name}`} onClick={() => setEditing(g)} />
                    <IconButton icon={Trash2} danger label={`Delete ${g.name}`} onClick={() => void remove(g)} />
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      {editing && (
        <GoalModal
          goal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            bump()
          }}
        />
      )}
      {updatingSaved && (
        <SavedModal
          goal={updatingSaved}
          onClose={() => setUpdatingSaved(null)}
          onSaved={() => {
            setUpdatingSaved(null)
            bump()
          }}
        />
      )}
    </div>
  )
}

function GoalModal({ goal, onClose, onSaved }: { goal: GoalProgress | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : '')
  const [current, setCurrent] = useState(goal ? String(goal.currentAmount) : '')
  const [due, setDue] = useState(goal?.dueDate ?? '')
  const [note, setNote] = useState(goal?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    const targetValue = parseMoney(target)
    const currentValue = current.trim() === '' ? 0 : parseMoney(current)
    if (!name.trim()) return setError('Give your goal a name.')
    if (targetValue === null || targetValue <= 0) return setError('Enter a target amount greater than zero.')
    if (currentValue === null || currentValue < 0) return setError('The saved amount cannot be negative.')
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), targetAmount: targetValue, currentAmount: currentValue, dueDate: due || null, note }
      if (goal) await api.goals.update({ id: goal.id, ...payload })
      else await api.goals.create(payload)
      toast.success(goal ? 'Goal updated.' : 'Goal created.')
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
      title={goal ? 'Edit goal' : 'New goal'}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {goal ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        {error && <Alert kind="danger">{error}</Alert>}
        <Field label="Goal name" required>
          {(p) => <Input {...p} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" />}
        </Field>
        <div className="form-grid">
          <Field label="Target amount" required>
            {(p) => <MoneyInput {...p} value={target} onChange={setTarget} placeholder="0.00" />}
          </Field>
          <Field label="Currently saved" hint="Leave blank to start at zero.">
            {(p) => <MoneyInput {...p} value={current} onChange={setCurrent} placeholder="0.00" />}
          </Field>
          <Field label="Due date" hint="Optional.">
            {(p) => <Input {...p} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
        </div>
        <Field label="Note" hint="Optional.">
          {(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function SavedModal({ goal, onClose, onSaved }: { goal: GoalProgress; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [value, setValue] = useState(String(goal.currentAmount))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    const v = parseMoney(value)
    if (v === null || v < 0) return setError('Enter the amount saved so far (zero or more).')
    setSaving(true)
    setError(null)
    try {
      await api.goals.setSaved({ id: goal.id, currentAmount: v })
      toast.success('Saved amount updated.')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      size="sm"
      title="Update saved amount"
      subtitle={goal.name}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        {error && <Alert kind="danger">{error}</Alert>}
        <Field label="Total saved so far" required hint="This replaces the current amount.">
          {(p) => <MoneyInput {...p} value={value} onChange={setValue} autoFocus />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
