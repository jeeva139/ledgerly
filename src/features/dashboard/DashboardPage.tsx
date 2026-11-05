import { useMemo } from 'react'
import { Download, Gauge, PiggyBank, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { DashboardData } from '@shared/api/reports'
import { PERIODS } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Card, PageHeader, StatCard } from '@/components/layout'
import { useQuery } from '@/hooks/useQuery'
import { api } from '@/services/api'
import { ChartCard, type ChartTable } from '../charts/ChartCard'
import { RankedBars, type RankedItem } from '../charts/RankedBars'
import { CashFlowChart, IncomeExpenseChart, SpendingBarsChart } from '../charts/TimeCharts'
import { bucketLabelLong } from '../charts/format'
import { useChartColors } from '../charts/useChartColors'
import { InsightsCard, NeedsReviewCard, RecentActivityCard, SubscriptionsCard, UpcomingRecurringCard } from './DashboardCards'
import './dashboard.css'

export function DashboardPage() {
  const { period, fmt, setPeriod } = useApp()
  const q = useQuery(() => api.dashboard.get({ period }), [period])
  const data = q.data

  const subtitle = useMemo(() => {
    if (!data) return undefined
    const label = PERIODS.find((p) => p.id === data.period)?.label ?? ''
    const { from, to } = data.range
    return from && to ? `${label} · ${fmt.date(from)} – ${fmt.date(to)}` : `${label} · every transaction on this computer`
  }, [data, fmt])

  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : <Loading label="Loading your dashboard…" />}
      </div>
    )
  }

  const periodHasData = data.summary.transactionCount > 0 || data.buckets.length > 0

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle={subtitle} />
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      <div className={`stack lg dash-refresh${q.loading ? ' stale' : ''}`} aria-busy={q.loading}>
        <SummaryCards data={data} />

        {!data.hasTransactions ? (
          <Card>
            <NoTransactions />
          </Card>
        ) : (
          <>
            <InsightsCard data={data} />
            {periodHasData ? (
              <Charts data={data} refreshing={q.loading} />
            ) : (
              <Card>
                <EmptyState
                  icon={Gauge}
                  title="No transactions in this period"
                  action={<Button onClick={() => void setPeriod('all-time')}>Show all time</Button>}
                >
                  Choose a different period to see your charts, or add a transaction dated in this period.
                </EmptyState>
              </Card>
            )}
            <div className="grid cols-21">
              <RecentActivityCard rows={data.recent} hasAny={data.hasTransactions} />
              <NeedsReviewCard data={data} />
            </div>
            <div className="grid cols-2">
              <UpcomingRecurringCard items={data.upcoming} />
              <SubscriptionsCard data={data} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NoTransactions() {
  const { navigate, openAddEntry } = useApp()
  return (
    <EmptyState
      icon={Wallet}
      title="No transactions yet"
      action={
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Button variant="primary" icon={Download} onClick={() => navigate('import')}>
            Import statement
          </Button>
          <Button icon={Plus} onClick={() => openAddEntry()}>
            Add entry
          </Button>
        </div>
      }
    >
      Import a bank statement or add your first transaction. Your charts, insights and savings rate appear here as soon as there is real data to show.
    </EmptyState>
  )
}

function SummaryCards({ data }: { data: DashboardData }) {
  const { fmt, navigate } = useApp()
  const s = data.summary
  const nw = s.netWorth
  const hasData = s.transactionCount > 0
  const rate = Math.round(s.savingsRate * 10) / 10

  return (
    <div className="stack">
      <div className="grid cols-4">
        <StatCard
          dark
          label="Net worth"
          icon={Wallet}
          notSet={!nw.configured}
          value={nw.configured && nw.value !== null ? fmt.money(nw.value) : 'Not set'}
          hint={
            nw.configured ? (
              <>
                Assets {fmt.money(nw.assets)} − liabilities {fmt.money(nw.liabilities)}
              </>
            ) : (
              <>
                Add your assets and liabilities in Settings → Net Worth.
                <br />
                <Button size="sm" className="on-dark" onClick={() => navigate('settings', { section: 'net-worth' })}>
                  Set up net worth
                </Button>
              </>
            )
          }
        />
        <StatCard
          label="Income"
          icon={TrendingUp}
          tone="positive"
          value={fmt.money(s.income)}
          hint={`${s.incomeCount.toLocaleString()} income transaction${s.incomeCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Spending"
          icon={TrendingDown}
          tone="spending"
          value={fmt.money(s.spending)}
          hint={`${s.spendingCount.toLocaleString()} expense transaction${s.spendingCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Savings rate"
          icon={PiggyBank}
          tone="info"
          value={hasData ? `${rate}%` : '—'}
          hint={
            !hasData
              ? 'Needs income and spending data'
              : s.income <= 0
                ? 'No income in this period'
                : s.net >= 0
                  ? `${fmt.money(s.net)} saved of ${fmt.money(s.income)} earned`
                  : `Spent ${fmt.money(-s.net)} more than earned`
          }
        />
      </div>
      <p className="dash-note">Transfers between your own accounts are never counted as income, spending or savings.</p>
    </div>
  )
}

function Charts({ data, refreshing }: { data: DashboardData; refreshing: boolean }) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const { buckets, granularity } = data
  const unit = granularity === 'day' ? 'Daily' : 'Monthly'
  const when = (k: string) => bucketLabelLong(k, granularity)

  const cashFlowTable = useMemo<ChartTable>(
    () => ({
      caption: 'Cash flow by period',
      columns: [{ label: granularity === 'day' ? 'Day' : 'Month' }, { label: 'Income', numeric: true }, { label: 'Spending', numeric: true }, { label: 'Net', numeric: true }, { label: 'Running total', numeric: true }],
      rows: buckets.map((b) => [when(b.key), fmt.money(b.income), fmt.money(b.expense), fmt.money(b.net, { sign: true }), fmt.money(b.cumulative)])
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, granularity, fmt]
  )
  const spendingTable = useMemo<ChartTable>(
    () => ({
      caption: `${unit} spending`,
      columns: [{ label: granularity === 'day' ? 'Day' : 'Month' }, { label: 'Spending', numeric: true }],
      rows: buckets.map((b) => [when(b.key), fmt.money(b.expense)])
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, granularity, fmt, unit]
  )
  const categoryTable = useMemo<ChartTable>(
    () => ({
      caption: 'Spending by category',
      columns: [{ label: 'Category' }, { label: 'Spending', numeric: true }, { label: 'Share', numeric: true }, { label: 'Transactions', numeric: true }],
      rows: data.categories.map((c) => [c.name, fmt.money(c.total), `${c.pct}%`, c.count.toLocaleString()])
    }),
    [data.categories, fmt]
  )

  const categoryItems: RankedItem[] = data.categories.map((c) => ({
    key: c.name,
    label: c.name,
    value: c.total,
    pct: c.pct,
    detail: `${c.count} transaction${c.count === 1 ? '' : 's'}`,
    muted: c.isOther
  }))

  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  const hasSpending = data.summary.spending > 0
  const periodText = first && last ? `${when(first.key)} to ${when(last.key)}` : ''

  return (
    <div className="stack lg">
      <div className="grid cols-21">
        <ChartCard
          title="Cash flow"
          subtitle="Running total of income minus spending"
          refreshing={refreshing}
          ariaLabel={`Cash flow: running total from ${periodText}, ending at ${last ? fmt.money(last.cumulative) : 'nothing'}. A table view is available.`}
          table={cashFlowTable}
        >
          <CashFlowChart buckets={buckets} granularity={granularity} />
        </ChartCard>
        <ChartCard
          title="Spending by category"
          subtitle="Share of total spending"
          refreshing={refreshing}
          ariaLabel="Spending by category as ranked bars. A table view is available."
          table={categoryTable}
          empty={
            hasSpending ? undefined : (
              <EmptyState compact icon={TrendingDown} title="No spending in this period">
                Expenses will be ranked by category here.
              </EmptyState>
            )
          }
        >
          <RankedBars items={categoryItems} color={colors.spending} unitLabel="Spending by category" />
        </ChartCard>
      </div>
      <div className="grid cols-2">
        <ChartCard
          title={`${unit} spending`}
          subtitle={granularity === 'day' ? 'Per day (short history)' : 'Per month'}
          refreshing={refreshing}
          ariaLabel={`${unit} spending, ${periodText}. A table view is available.`}
          table={spendingTable}
          empty={hasSpending ? undefined : <EmptyState compact icon={TrendingDown} title="No spending in this period" />}
        >
          <SpendingBarsChart buckets={buckets} granularity={granularity} />
        </ChartCard>
        <ChartCard
          title="Income vs expense"
          subtitle={granularity === 'day' ? 'Per day' : 'Per month'}
          refreshing={refreshing}
          legend={[
            { label: 'Income', color: colors.positive },
            { label: 'Spending', color: colors.spending }
          ]}
          ariaLabel={`Income and spending side by side per ${granularity}, ${periodText}. A table view is available.`}
          table={cashFlowTable}
        >
          <IncomeExpenseChart buckets={buckets} granularity={granularity} />
        </ChartCard>
      </div>
    </div>
  )
}
