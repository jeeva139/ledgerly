import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Landmark, LineChart, Store, Tags, TrendingDown } from 'lucide-react'
import type { TimeBucket } from '@shared/api/reports'
import { formatMonthKey } from '@shared/dates'
import { round2 } from '@shared/money'
import { categoryLabel, type PeriodId } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { Checkbox } from '@/components/form'
import { EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Card, StatCard } from '@/components/layout'
import { useQuery, type QueryState } from '@/hooks/useQuery'
import { api } from '@/services/api'
import { ChartCard, DataTable, type ChartTable } from '../charts/ChartCard'
import { RankedBars, type RankedItem } from '../charts/RankedBars'
import { CategoryTrendsChart, IncomeExpenseChart, SpendingBarsChart } from '../charts/TimeCharts'
import { useChartColors } from '../charts/useChartColors'
import { ReportHead, foldRows, periodLabel, useCsvExport } from './ReportParts'

interface ViewProps {
  period: PeriodId
}

/** Common loading / error gate. Returns the data once available. */
function Gate<T>({ q, children }: { q: QueryState<T>; children: (data: T) => ReactNode }) {
  if (!q.data) return q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : <Loading label="Loading report…" />
  return (
    <div className={`report-refresh${q.loading ? ' stale' : ''}`} aria-busy={q.loading}>
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      {children(q.data)}
    </div>
  )
}

function Empty({ icon, title, children }: { icon: typeof BarChart3; title: string; children?: ReactNode }) {
  return (
    <Card>
      <EmptyState icon={icon} title={title}>
        {children}
      </EmptyState>
    </Card>
  )
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------------------------------------
// Spending by category
// ---------------------------------------------------------------------------------------------

export function SpendingByCategoryView({ period }: ViewProps) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const [rollUp, setRollUp] = useState(true)
  const q = useQuery(() => api.reports.spendingByCategory({ period, rollUp }), [period, rollUp])
  const { exportCsv, exporting } = useCsvExport('spending-by-category', period)

  return (
    <Gate q={q}>
      {(d) => {
        const rows = d.rows
        const items: RankedItem[] = foldRows(
          rows.map((r) => ({ ...r })),
          12,
          (total, count, pct, hidden) => ({ name: `Other (${hidden} more)`, total, count, pct, isOther: true })
        ).map((r) => ({
          key: r.name,
          label: r.name,
          value: r.total,
          pct: r.pct,
          detail: plural(r.count, 'transaction'),
          muted: r.isOther
        }))
        const table: ChartTable = {
          caption: 'Spending by category',
          columns: [{ label: 'Category' }, { label: 'Spending', numeric: true }, { label: '% of spending', numeric: true }, { label: 'Transactions', numeric: true }],
          rows: rows.map((r) => [categoryLabel(r.name), fmt.money(r.total), `${r.pct}%`, r.count.toLocaleString()]),
          footer: ['Total', fmt.money(d.total), '100%', d.count.toLocaleString()]
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Spending by category"
              description="Where your money went in the selected period. Transfers between your own accounts are not counted."
              onExport={() =>
                void exportCsv(['Category', 'Spending', 'Percent of spending', 'Transactions'], rows.map((r) => [r.name, round2(r.total), r.pct, r.count]))
              }
              exporting={exporting}
            />
            <div className="report-controls">
              <Checkbox checked={rollUp} onChange={setRollUp} label="Group subcategories under their parent category" />
              <span className="report-summary">
                <span>
                  Total spending <strong>{fmt.money(d.total)}</strong>
                </span>
                <span>
                  <strong>{plural(d.count, 'transaction')}</strong> · {periodLabel(period)}
                </span>
              </span>
            </div>
            {rows.length === 0 ? (
              <Empty icon={TrendingDown} title="No spending in this period">
                Expenses will be ranked by category here.
              </Empty>
            ) : (
              <>
                <ChartCard title="Ranked by spending" ariaLabel="Spending by category as ranked bars. The full table is below." refreshing={q.loading}>
                  <RankedBars items={items} color={colors.spending} unitLabel="Spending by category" />
                </ChartCard>
                <Card flush className="report-table" title="All categories">
                  <DataTable table={table} />
                </Card>
              </>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Monthly spending
// ---------------------------------------------------------------------------------------------

function monthsToBuckets(rows: { month: string; income: number; expense: number; net: number }[]): TimeBucket[] {
  let cumulative = 0
  return rows.map((r) => {
    cumulative = round2(cumulative + r.net)
    return { key: r.month, income: r.income, expense: r.expense, net: r.net, cumulative }
  })
}

export function MonthlyView({ period }: ViewProps) {
  const { fmt } = useApp()
  const q = useQuery(() => api.reports.monthly({ period }), [period])
  const { exportCsv, exporting } = useCsvExport('monthly-spending', period)

  return (
    <Gate q={q}>
      {(d) => {
        const buckets = monthsToBuckets(d.rows)
        const table: ChartTable = {
          caption: 'Monthly income, spending and net',
          columns: [{ label: 'Month' }, { label: 'Expense', numeric: true }, { label: 'Income', numeric: true }, { label: 'Net', numeric: true }],
          rows: d.rows.map((r) => [formatMonthKey(r.month), fmt.money(r.expense), fmt.money(r.income), fmt.money(r.net, { sign: true })]),
          footer: ['Total', fmt.money(d.totals.expense), fmt.money(d.totals.income), fmt.money(d.totals.net, { sign: true })]
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Monthly spending"
              description="Spending, income and the difference for every month that has transactions."
              onExport={() => void exportCsv(['Month', 'Expense', 'Income', 'Net'], d.rows.map((r) => [r.month, r.expense, r.income, r.net]))}
              exporting={exporting}
            />
            {d.rows.length === 0 ? (
              <Empty icon={BarChart3} title="No transactions in this period">
                Monthly figures appear here once there are transactions.
              </Empty>
            ) : (
              <>
                <ChartCard title="Spending per month" ariaLabel="Monthly spending as bars. The full table is below." refreshing={q.loading}>
                  <SpendingBarsChart buckets={buckets} granularity="month" />
                </ChartCard>
                <Card flush className="report-table" title="Month by month">
                  <DataTable table={table} />
                </Card>
              </>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Income vs spending
// ---------------------------------------------------------------------------------------------

export function IncomeVsSpendingView({ period }: ViewProps) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const q = useQuery(() => api.reports.monthly({ period }), [period])
  const { exportCsv, exporting } = useCsvExport('income-vs-spending', period)

  return (
    <Gate q={q}>
      {(d) => {
        const buckets = monthsToBuckets(d.rows)
        const table: ChartTable = {
          caption: 'Income versus spending by month',
          columns: [{ label: 'Month' }, { label: 'Income', numeric: true }, { label: 'Spending', numeric: true }, { label: 'Net', numeric: true }],
          rows: d.rows.map((r) => [formatMonthKey(r.month), fmt.money(r.income), fmt.money(r.expense), fmt.money(r.net, { sign: true })]),
          footer: ['Total', fmt.money(d.totals.income), fmt.money(d.totals.expense), fmt.money(d.totals.net, { sign: true })]
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Income vs spending"
              description="Money in compared with money out, month by month."
              onExport={() => void exportCsv(['Month', 'Income', 'Spending', 'Net'], d.rows.map((r) => [r.month, r.income, r.expense, r.net]))}
              exporting={exporting}
            />
            {d.rows.length === 0 ? (
              <Empty icon={BarChart3} title="No transactions in this period">
                Income and spending are compared here once there are transactions.
              </Empty>
            ) : (
              <>
                <div className="grid cols-4">
                  <StatCard label="Income" tone="positive" value={fmt.money(d.totals.income)} />
                  <StatCard label="Spending" tone="spending" value={fmt.money(d.totals.expense)} />
                  <StatCard label="Net" tone="accent" value={fmt.money(d.totals.net, { sign: true })} />
                  <StatCard
                    label="Savings rate"
                    tone="info"
                    value={`${Math.round(d.totals.savingsRate * 10) / 10}%`}
                    hint={d.totals.income > 0 ? undefined : 'No income in this period'}
                  />
                </div>
                <ChartCard
                  title="Income and spending per month"
                  legend={[
                    { label: 'Income', color: colors.positive },
                    { label: 'Spending', color: colors.spending }
                  ]}
                  ariaLabel="Income and spending side by side for each month. A table view is available."
                  table={table}
                  refreshing={q.loading}
                >
                  <IncomeExpenseChart buckets={buckets} granularity="month" />
                </ChartCard>
              </>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Category trends
// ---------------------------------------------------------------------------------------------

export function CategoryTrendsView({ period }: ViewProps) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const q = useQuery(() => api.reports.categoryTrends({ period, top: 5 }), [period])
  const { exportCsv, exporting } = useCsvExport('category-trends', period)

  return (
    <Gate q={q}>
      {(d) => {
        const table: ChartTable = {
          caption: 'Monthly spending for the top categories',
          columns: [{ label: 'Month' }, ...d.series.map((s) => ({ label: categoryLabel(s.name), numeric: true }))],
          rows: d.months.map((m, i) => [formatMonthKey(m), ...d.series.map((s) => fmt.money(s.values[i]))]),
          footer: ['Total', ...d.series.map((s) => fmt.money(s.total))]
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Category trends"
              description="Monthly spending in your five biggest categories — real history only."
              onExport={() =>
                void exportCsv(['Month', ...d.series.map((s) => s.name)], d.months.map((m, i) => [m, ...d.series.map((s) => s.values[i])]))
              }
              exporting={exporting}
            />
            {d.series.length === 0 ? (
              <Empty icon={LineChart} title="No spending in this period">
                Category trends appear once there is spending history.
              </Empty>
            ) : (
              <ChartCard
                title="Top categories by month"
                subtitle={d.months.length < 2 ? 'Only one month of history so far — trends need at least two months.' : undefined}
                legend={d.series.map((s, i) => ({ label: categoryLabel(s.name), color: colors.series[i % colors.series.length], shape: 'line' as const }))}
                ariaLabel="Monthly spending lines for the top categories. A table view is available."
                table={table}
                refreshing={q.loading}
              >
                <CategoryTrendsChart months={d.months} series={d.series} />
              </ChartCard>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Top merchants
// ---------------------------------------------------------------------------------------------

export function TopMerchantsView({ period }: ViewProps) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const q = useQuery(() => api.reports.topMerchants({ period, limit: 15 }), [period])
  const { exportCsv, exporting } = useCsvExport('top-merchants', period)

  return (
    <Gate q={q}>
      {(d) => {
        const items: RankedItem[] = d.rows.map((r) => ({
          key: r.key,
          label: r.name,
          value: r.total,
          pct: r.pct,
          detail: plural(r.count, 'transaction')
        }))
        const table: ChartTable = {
          caption: 'Top merchants by spending',
          columns: [{ label: 'Merchant' }, { label: 'Spending', numeric: true }, { label: '% of spending', numeric: true }, { label: 'Transactions', numeric: true }],
          rows: d.rows.map((r) => [r.name, fmt.money(r.total), `${r.pct}%`, r.count.toLocaleString()])
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Top merchants"
              description="Your 15 biggest payees. Bank narrations are tidied so the same merchant is grouped together (reference numbers are ignored)."
              onExport={() => void exportCsv(['Merchant', 'Spending', 'Percent of spending', 'Transactions'], d.rows.map((r) => [r.name, r.total, r.pct, r.count]))}
              exporting={exporting}
            />
            {d.rows.length === 0 ? (
              <Empty icon={Store} title="No spending in this period">
                Merchants are ranked here once there are expenses.
              </Empty>
            ) : (
              <ChartCard
                title="Biggest merchants"
                subtitle={`Total spending ${fmt.money(d.totalSpending)}`}
                ariaLabel="Top merchants as ranked bars. A table view is available."
                table={table}
                refreshing={q.loading}
              >
                <RankedBars items={items} color={colors.spending} unitLabel="Top merchants" />
              </ChartCard>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Account analysis
// ---------------------------------------------------------------------------------------------

export function AccountsView({ period }: ViewProps) {
  const { fmt } = useApp()
  const q = useQuery(() => api.reports.accounts({ period }), [period])
  const { exportCsv, exporting } = useCsvExport('accounts', period)

  return (
    <Gate q={q}>
      {(d) => {
        const dash = <span className="dim">—</span>
        const hasBalance = d.rows.some((r) => r.balance !== null)
        return (
          <div className="stack lg">
            <ReportHead
              title="Account analysis"
              description="Activity per account in the selected period. A balance is shown only for accounts where you entered an opening balance."
              onExport={() =>
                void exportCsv(
                  ['Account', 'Transactions', 'Money in', 'Money out', 'Net', 'Transfers in', 'Transfers out', 'Opening balance', 'Balance'],
                  d.rows.map((r) => [r.account, r.count, r.moneyIn, r.moneyOut, r.net, r.transfersIn, r.transfersOut, r.openingBalance ?? '', r.balance ?? ''])
                )
              }
              exporting={exporting}
            />
            {d.rows.length === 0 ? (
              <Empty icon={Landmark} title="No account activity yet">
                Accounts appear here once transactions are assigned to them.
              </Empty>
            ) : (
              <Card flush className="report-table" title="Accounts">
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Activity and balance per account</caption>
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col" className="num">Transactions</th>
                        <th scope="col" className="num">Money in</th>
                        <th scope="col" className="num">Money out</th>
                        <th scope="col" className="num">Net</th>
                        <th scope="col" className="num">Transfers in</th>
                        <th scope="col" className="num">Transfers out</th>
                        <th scope="col" className="num">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.account}>
                          <th scope="row">
                            {r.account}
                            {!r.managed && <span className="pill" style={{ marginLeft: 8 }} title="Transactions use this account name, but it is not in your account list (Settings → Accounts).">not in account list</span>}
                          </th>
                          <td className="num">{r.count.toLocaleString()}</td>
                          <td className="num pos">{fmt.money(r.moneyIn)}</td>
                          <td className="num neg">{fmt.money(r.moneyOut)}</td>
                          <td className="num">{fmt.money(r.net, { sign: true })}</td>
                          <td className="num">{fmt.money(r.transfersIn)}</td>
                          <td className="num">{fmt.money(r.transfersOut)}</td>
                          <td className="num">{r.balance === null ? dash : fmt.money(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="report-note" style={{ padding: '10px 14px' }}>
                  Money in / out exclude transfers between your accounts, which are shown separately.
                  {hasBalance
                    ? ' Balance = opening balance + all income − all expenses (all dates, transfers included).'
                    : ' Add an opening balance to an account in Settings → Accounts to see its balance.'}
                </p>
              </Card>
            )}
          </div>
        )
      }}
    </Gate>
  )
}

// ---------------------------------------------------------------------------------------------
// Tag analysis
// ---------------------------------------------------------------------------------------------

export function TagsView({ period }: ViewProps) {
  const { fmt } = useApp()
  const colors = useChartColors()
  const q = useQuery(() => api.reports.tags({ period }), [period])
  const { exportCsv, exporting } = useCsvExport('tags', period)

  const spendingItems = useMemo<RankedItem[]>(() => {
    const rows = (q.data?.rows ?? []).filter((r) => r.spending > 0).slice(0, 12)
    const total = (q.data?.rows ?? []).reduce((s, r) => s + r.spending, 0)
    return rows.map((r) => ({
      key: r.tag,
      label: r.tag,
      value: r.spending,
      pct: total > 0 ? Math.round((r.spending / total) * 1000) / 10 : 0,
      detail: plural(r.count, 'transaction')
    }))
  }, [q.data])

  return (
    <Gate q={q}>
      {(d) => {
        const table: ChartTable = {
          caption: 'Tag usage and amounts',
          columns: [{ label: 'Tag' }, { label: 'Transactions', numeric: true }, { label: 'Spending', numeric: true }, { label: 'Income', numeric: true }],
          rows: d.rows.map((r) => [r.tag, r.count.toLocaleString(), fmt.money(r.spending), fmt.money(r.income)])
        }
        return (
          <div className="stack lg">
            <ReportHead
              title="Tag analysis"
              description="How your tags are used and how much money sits behind each one. Tags are independent of categories."
              onExport={() => void exportCsv(['Tag', 'Transactions', 'Spending', 'Income'], d.rows.map((r) => [r.tag, r.count, r.spending, r.income]))}
              exporting={exporting}
            />
            {d.rows.length === 0 ? (
              <Empty icon={Tags} title="No tagged transactions in this period">
                Add tags to transactions to see how they are used here.
              </Empty>
            ) : (
              <>
                {spendingItems.length > 0 && (
                  <ChartCard title="Spending by tag" subtitle="A transaction with several tags counts under each of them" ariaLabel="Spending by tag as ranked bars. The full table is below." refreshing={q.loading}>
                    <RankedBars items={spendingItems} color={colors.spending} unitLabel="Spending by tag" />
                  </ChartCard>
                )}
                <Card flush className="report-table" title="All tags">
                  <DataTable table={table} />
                </Card>
              </>
            )}
          </div>
        )
      }}
    </Gate>
  )
}
