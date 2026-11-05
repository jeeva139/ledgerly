import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowDownUp, ListFilter, Pencil, Plus, ScrollText, Trash2, Wand2 } from 'lucide-react'
import { categoryLabel, type Rule } from '@shared/types'
import type { RulesListResult } from '@shared/api/rules'
import { api, errorMessage } from '@/services/api'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { Button, IconButton } from '@/components/Button'
import { Card, PageHeader } from '@/components/layout'
import { Alert, EmptyState, ErrorState, Loading, Pill } from '@/components/feedback'
import { Switch } from '@/components/form'
import { CategoryLabel } from '@/components/domain'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { MATCH_TYPE_LABELS, RuleModal } from './RuleModal'
import { BulkRecategorizeModal } from './BulkRecategorizeModal'
import './rules.css'

export function RulesPage() {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const q = useQuery<RulesListResult>(() => api.rules.list(), [])
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [bulk, setBulk] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sorting, setSorting] = useState(false)

  const rules = q.data?.rules ?? []
  const orderMode = q.data?.orderMode ?? 'auto'
  const hasEnabled = rules.some((r) => r.enabled)

  const run = async (id: string | null, fn: () => Promise<unknown>) => {
    setBusyId(id)
    try {
      await fn()
      q.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (rule: Rule) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `“${rule.whenText}” → ${categoryLabel(rule.thenText)}\n\nFuture imports will no longer use it. Transactions that were already categorized by it are not changed.`,
      confirmLabel: 'Delete rule',
      danger: true
    })
    if (ok) await run(rule.id, () => api.rules.delete({ id: rule.id }))
  }

  const sortAuto = async () => {
    setSorting(true)
    await run(null, () => api.rules.sortBySpecificity())
    setSorting(false)
  }

  return (
    <div className="page">
      <PageHeader
        title="Rules"
        subtitle="Rules automatically categorize transactions in future imports. They are checked in the order shown — the first matching rule wins."
        actions={
          <>
            <Button icon={Wand2} onClick={() => setBulk(true)} disabled={!hasEnabled} title={hasEnabled ? undefined : 'Create or enable a rule first'}>
              Bulk recategorize
            </Button>
            <Button
              icon={ArrowDownUp}
              onClick={() => void sortAuto()}
              loading={sorting}
              disabled={rules.length < 2 || orderMode === 'auto'}
              title={orderMode === 'auto' ? 'Rules are already ordered by specificity' : 'Put the most specific rules first again'}
            >
              Sort by specificity
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              New rule
            </Button>
          </>
        }
      />

      {q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <Loading label="Loading rules…" />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="No rules yet"
            action={
              <div className="row">
                <Button variant="primary" icon={ListFilter} onClick={() => app.navigate('category-finder')}>
                  Open Category Finder
                </Button>
                <Button icon={Plus} onClick={() => setEditing('new')}>
                  New rule
                </Button>
              </div>
            }
          >
            Create rules from the Category Finder or add one here. Rules categorize future imports automatically; they never rewrite your existing transactions on their own.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Alert kind="info">
            <div className="rules-order-note">
              <span>
                {orderMode === 'auto' ? (
                  <>
                    <strong>Automatic order:</strong> the most specific rule is checked first (longer, stricter text first; ties go to the earlier-created rule).
                  </>
                ) : (
                  <>
                    <strong>Manual order:</strong> you arranged these rules yourself, so new rules are added at the end. Use “Sort by specificity” to go back to automatic ordering.
                  </>
                )}
              </span>
            </div>
          </Alert>

          <Card flush>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Saved categorization rules in the order they are checked</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 64 }}>
                      Order
                    </th>
                    <th scope="col">When…</th>
                    <th scope="col">Then…</th>
                    <th scope="col">Source</th>
                    <th scope="col">Enabled</th>
                    <th scope="col" className="actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={r.id} className={r.enabled ? undefined : 'rule-row-disabled'}>
                      <td>
                        <span className="rule-order" title={`Checked ${i === 0 ? 'first' : `number ${i + 1}`}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td>
                        <div className="rule-when">
                          <Pill>{MATCH_TYPE_LABELS[r.matchType]}</Pill>
                          <span className="kw">“{r.whenText}”</span>
                        </div>
                      </td>
                      <td>
                        <CategoryLabel name={r.thenText} />
                      </td>
                      <td>
                        <Pill tone={r.source === 'category-finder' ? 'accent' : undefined}>{r.source === 'category-finder' ? 'Category Finder' : 'Manual'}</Pill>
                      </td>
                      <td className="enabled-col">
                        <Switch
                          checked={r.enabled}
                          label={`${r.enabled ? 'Disable' : 'Enable'} rule “${r.whenText}”`}
                          disabled={busyId === r.id}
                          onChange={(enabled) => void run(r.id, () => api.rules.setEnabled({ id: r.id, enabled }))}
                        />
                      </td>
                      <td className="actions">
                        <IconButton
                          icon={ArrowUp}
                          label={`Move rule “${r.whenText}” up`}
                          disabled={i === 0 || busyId !== null}
                          onClick={() => void run(r.id, () => api.rules.move({ id: r.id, direction: 'up' }))}
                        />
                        <IconButton
                          icon={ArrowDown}
                          label={`Move rule “${r.whenText}” down`}
                          disabled={i === rules.length - 1 || busyId !== null}
                          onClick={() => void run(r.id, () => api.rules.move({ id: r.id, direction: 'down' }))}
                        />
                        <IconButton icon={Pencil} label={`Edit rule “${r.whenText}”`} onClick={() => setEditing(r)} />
                        <IconButton icon={Trash2} danger label={`Delete rule “${r.whenText}”`} onClick={() => void remove(r)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="muted small">
            Rules only affect transactions imported <strong>after</strong> they exist. To apply them to transactions you already have, use <strong>Bulk recategorize</strong> — it shows a preview first.
          </p>
        </>
      )}

      {editing && (
        <RuleModal
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            toast.success(editing === 'new' ? `Rule created: “${saved.whenText}” → ${categoryLabel(saved.thenText)}.` : 'Rule saved.')
            q.reload()
          }}
        />
      )}
      {bulk && <BulkRecategorizeModal onClose={() => setBulk(false)} />}
    </div>
  )
}
