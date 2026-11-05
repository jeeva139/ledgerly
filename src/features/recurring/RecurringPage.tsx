import { useState } from 'react'
import { Import, Repeat, Settings as SettingsIcon } from 'lucide-react'
import type { RecurringItem } from '@shared/api/recurring'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Card, PageHeader, Tabs } from '@/components/layout'
import { useQuery } from '@/hooks/useQuery'
import { api } from '@/services/api'
import { HowDetectionWorks, RecurringTable, useRecurringDecisions, type RecurringMode } from './RecurringTable'

export function RecurringPage() {
  const { boot, navigate, fmt } = useApp()
  const { busyKey, decide } = useRecurringDecisions()
  const [tab, setTab] = useState<RecurringMode | null>(null)

  const items = useQuery(() => api.recurring.list(), [])
  const status = useQuery(() => api.recurring.status(), [])

  const all: RecurringItem[] = items.data ?? []
  const by = (s: RecurringMode) => all.filter((i) => i.status === s)
  const counts = { suggested: by('suggested').length, kept: by('kept').length, ignored: by('ignored').length }
  const active: RecurringMode = tab ?? (counts.suggested === 0 && counts.kept > 0 ? 'kept' : 'suggested')
  const shown = by(active)
  const disabled = status.data ? !status.data.recurringEnabled : false

  const keptMonthly = by('kept').reduce((s, i) => s + i.monthlyCost, 0)
  const keptAnnual = by('kept').reduce((s, i) => s + i.annualCost, 0)

  return (
    <div className="page">
      <PageHeader
        title="Recurring"
        subtitle="Payments that repeat on a regular schedule, detected from your own transactions. Ledgerly never confirms anything on its own — you choose Keep or Ignore."
      />

      {disabled && (
        <Alert
          kind="info"
          action={
            <Button size="sm" icon={SettingsIcon} onClick={() => navigate('settings', { section: 'detection' })}>
              Open Settings
            </Button>
          }
        >
          Recurring payment detection is turned off. Turn it back on in Settings → Detection to see suggestions here.
        </Alert>
      )}

      <Card flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs<RecurringMode>
            label="Recurring payments"
            value={active}
            onChange={setTab}
            tabs={[
              { id: 'suggested', label: `Suggested (${counts.suggested})` },
              { id: 'kept', label: `Kept (${counts.kept})` },
              { id: 'ignored', label: `Ignored (${counts.ignored})` }
            ]}
          />
        </div>

        {items.loading && !items.data ? (
          <Loading label="Looking for recurring payments…" />
        ) : items.error ? (
          <ErrorState message={items.error} onRetry={items.reload} />
        ) : shown.length === 0 ? (
          <EmptyBlock
            mode={active}
            detectedAny={all.length > 0}
            hasTransactions={boot.counts.transactions > 0}
            disabled={disabled}
            onImport={() => navigate('import')}
          />
        ) : (
          <>
            {active === 'kept' && (
              <div className="rec-summary">
                <span>
                  Estimated monthly total of kept payments: <strong>{fmt.money(keptMonthly)}</strong>
                </span>
                <span>
                  Estimated yearly total: <strong>{fmt.money(keptAnnual)}</strong>
                </span>
              </div>
            )}
            <RecurringTable items={shown} mode={active} busyKey={busyKey} onDecide={(i, d) => void decide(i, d)} />
          </>
        )}
      </Card>

      <HowDetectionWorks />
    </div>
  )
}

function EmptyBlock({ mode, detectedAny, hasTransactions, disabled, onImport }: {
  mode: RecurringMode
  detectedAny: boolean
  hasTransactions: boolean
  disabled: boolean
  onImport: () => void
}) {
  if (mode === 'suggested') {
    if (disabled) {
      return <EmptyState icon={Repeat} title="Recurring detection is off">Turn it on in Settings → Detection to see suggestions.</EmptyState>
    }
    if (detectedAny) {
      return <EmptyState icon={Repeat} title="No new suggestions">Everything Ledgerly detected has already been kept or ignored.</EmptyState>
    }
    return (
      <EmptyState
        icon={Repeat}
        title="No recurring payments detected"
        action={
          hasTransactions ? undefined : (
            <Button icon={Import} onClick={onImport}>
              Import a statement
            </Button>
          )
        }
      >
        Ledgerly will analyze your transactions when enough history exists.
      </EmptyState>
    )
  }
  if (mode === 'kept') {
    return (
      <EmptyState icon={Repeat} title="Nothing kept yet">
        Keep a suggested payment to track it. Kept payments show up as upcoming payments on your dashboard.
      </EmptyState>
    )
  }
  return (
    <EmptyState icon={Repeat} title="No ignored payments">
      Payments you ignore are listed here so you can restore them later.
    </EmptyState>
  )
}
