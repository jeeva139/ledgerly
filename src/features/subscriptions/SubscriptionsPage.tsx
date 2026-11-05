import { useState } from 'react'
import { CalendarClock, CalendarRange, Import, Lightbulb, Settings as SettingsIcon, WalletCards } from 'lucide-react'
import type { RecurringStatus } from '@shared/api/recurring'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Card, PageHeader, StatCard, Tabs } from '@/components/layout'
import { useQuery } from '@/hooks/useQuery'
import { api } from '@/services/api'
import { HowDetectionWorks, RecurringTable, useRecurringDecisions, type RecurringMode } from '../recurring/RecurringTable'

export function SubscriptionsPage() {
  const { boot, navigate, fmt } = useApp()
  const { busyKey, decide } = useRecurringDecisions()
  const [tab, setTab] = useState<RecurringMode | null>(null)

  const q = useQuery(() => api.subscriptions.list({ status: 'all' as RecurringStatus }), [])
  const items = q.data?.items ?? []
  const summary = q.data?.summary
  const enabled = q.data?.enabled ?? true

  const by = (s: RecurringMode) => items.filter((i) => i.status === s)
  const counts = { suggested: by('suggested').length, kept: by('kept').length, ignored: by('ignored').length }
  const active: RecurringMode = tab ?? (counts.kept > 0 ? 'kept' : 'suggested')
  const shown = by(active)

  return (
    <div className="page">
      <PageHeader
        title="Subscriptions"
        subtitle="Regular payments to well-known services, found in your own transactions. Only the subscriptions you keep count towards the totals."
      />

      {!enabled && (
        <Alert
          kind="info"
          action={
            <Button size="sm" icon={SettingsIcon} onClick={() => navigate('settings', { section: 'detection' })}>
              Open Settings
            </Button>
          }
        >
          Subscription detection is turned off. Turn it back on in Settings → Detection.
        </Alert>
      )}

      <div className="grid cols-4">
        <StatCard icon={CalendarClock} tone="accent" label="Kept subscriptions" value={summary ? summary.keptCount.toLocaleString() : '—'} hint="Subscriptions you chose to keep" />
        <StatCard
          icon={WalletCards}
          tone="spending"
          label="Estimated monthly cost"
          value={summary ? fmt.money(summary.keptMonthlyCost) : '—'}
          hint="Kept subscriptions only"
        />
        <StatCard
          icon={CalendarRange}
          tone="info"
          label="Estimated yearly cost"
          value={summary ? fmt.money(summary.keptAnnualCost) : '—'}
          hint="Kept subscriptions only"
        />
        <StatCard
          icon={Lightbulb}
          tone="positive"
          label="Suggestions"
          value={summary ? summary.suggestedCount.toLocaleString() : '—'}
          hint="Not counted until you keep them"
        />
      </div>

      <Card flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs<RecurringMode>
            label="Subscriptions"
            value={active}
            onChange={setTab}
            tabs={[
              { id: 'kept', label: `Kept (${counts.kept})` },
              { id: 'suggested', label: `Suggested (${counts.suggested})` },
              { id: 'ignored', label: `Ignored (${counts.ignored})` }
            ]}
          />
        </div>
        {q.loading && !q.data ? (
          <Loading label="Looking for subscriptions…" />
        ) : q.error ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : shown.length === 0 ? (
          <EmptyBlock mode={active} anyDetected={items.length > 0} enabled={enabled} hasTransactions={boot.counts.transactions > 0} onImport={() => navigate('import')} />
        ) : (
          <RecurringTable items={shown} mode={active} busyKey={busyKey} onDecide={(i, d) => void decide(i, d)} showKind={false} />
        )}
      </Card>

      <HowDetectionWorks subscriptionsOnly />
    </div>
  )
}

function EmptyBlock({ mode, anyDetected, enabled, hasTransactions, onImport }: {
  mode: RecurringMode
  anyDetected: boolean
  enabled: boolean
  hasTransactions: boolean
  onImport: () => void
}) {
  if (!enabled) return <EmptyState icon={CalendarClock} title="Subscription detection is off">Turn it on in Settings → Detection.</EmptyState>
  if (mode === 'kept') {
    return (
      <EmptyState icon={CalendarClock} title="No kept subscriptions">
        {anyDetected ? 'Keep a suggestion to include it in your monthly and yearly cost.' : 'Subscriptions you keep are listed here with their monthly and yearly cost.'}
      </EmptyState>
    )
  }
  if (mode === 'ignored') {
    return <EmptyState icon={CalendarClock} title="No ignored subscriptions">Subscriptions you ignore are listed here so you can restore them.</EmptyState>
  }
  if (anyDetected) return <EmptyState icon={CalendarClock} title="No new suggestions">Everything detected has already been kept or ignored.</EmptyState>
  return (
    <EmptyState
      icon={CalendarClock}
      title="No subscriptions detected"
      action={
        hasTransactions ? undefined : (
          <Button icon={Import} onClick={onImport}>
            Import a statement
          </Button>
        )
      }
    >
      Ledgerly recognises well-known services — and payments in your Subscriptions category — once a payment repeats on a regular schedule.
      Other regular payments appear under Recurring.
    </EmptyState>
  )
}
