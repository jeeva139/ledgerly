import { ArrowRight, CalendarClock, CheckCircle2, Lightbulb, Repeat, TriangleAlert } from 'lucide-react'
import type { DashboardData, TransactionLite, UpcomingPayment } from '@shared/api/reports'
import { NEEDS_REVIEW, type TxnType } from '@shared/types'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { CategoryLabel, Money, NeedsReviewPill } from '@/components/domain'
import { EmptyState } from '@/components/feedback'
import { Card } from '@/components/layout'
import { describeInsight } from './insights'

export function InsightsCard({ data }: { data: DashboardData }) {
  const { fmt, navigate } = useApp()
  if (data.insights.length === 0) return null
  const items = data.insights.map((i) => describeInsight(i, data.period, (n) => fmt.money(n)))
  return (
    <Card title="Insights">
      <ul className="insight-list">
        {items.map((it) => (
          <li key={it.id} className={it.tone}>
            {it.tone === 'warning' ? <TriangleAlert size={18} aria-hidden /> : <Lightbulb size={18} aria-hidden />}
            <span className="insight-text">{it.text}</span>
            {it.action === 'review' && (
              <Button size="sm" onClick={() => navigate('transactions', { category: NEEDS_REVIEW })}>
                Review
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="dash-note" style={{ marginTop: 10 }}>
        Based only on the transactions stored on this computer. Transfers between your own accounts are not counted.
      </p>
    </Card>
  )
}

function TxnTypeAmount({ t }: { t: TransactionLite }) {
  return t.isTransfer ? <span className="num muted">{t.type === 'income' ? '+' : '−'}Transfer</span> : <Money amount={t.amount} type={t.type as TxnType} />
}

export function RecentActivityCard({ rows, hasAny }: { rows: TransactionLite[]; hasAny: boolean }) {
  const { fmt, navigate } = useApp()
  return (
    <Card
      title="Recent activity"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('transactions')}>
          View all <ArrowRight size={14} aria-hidden />
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={CalendarClock} title={hasAny ? 'No activity in this period' : 'No transactions yet'}>
          {hasAny ? 'Choose a different period to see other transactions.' : 'Import a statement or add your first transaction.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table recent-table">
            <caption className="sr-only">Latest transactions</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Merchant</th>
                <th scope="col" className="hide-narrow">
                  Category
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{fmt.date(t.date)}</td>
                  <td style={{ maxWidth: 260 }}>
                    <div className="truncate" title={t.merchant}>
                      {t.merchant}
                    </div>
                  </td>
                  <td className="hide-narrow" style={{ maxWidth: 170 }}>
                    {t.category === NEEDS_REVIEW ? <NeedsReviewPill /> : <CategoryLabel name={t.category} />}
                  </td>
                  <td className="num">
                    <TxnTypeAmount t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function NeedsReviewCard({ data }: { data: DashboardData }) {
  const { fmt, navigate } = useApp()
  const { count, latest } = data.needsReview
  return (
    <Card title="Needs review">
      {count === 0 ? (
        <EmptyState compact icon={CheckCircle2} title={data.hasTransactions ? 'Nothing to review' : 'No transactions yet'}>
          {data.hasTransactions ? 'Every transaction has a category.' : 'Transactions without a category will be listed here.'}
        </EmptyState>
      ) : (
        <div className="stack">
          <div>
            <div className="big-count">{count.toLocaleString()}</div>
            <div className="dash-note">transaction{count === 1 ? '' : 's'} without a category (all dates)</div>
          </div>
          <ul className="mini-list">
            {latest.map((t) => (
              <li key={t.id}>
                <div className="primary truncate" title={t.merchant}>
                  {t.merchant}
                </div>
                <div className="amount">
                  <Money amount={t.amount} type={t.type} />
                </div>
                <div className="secondary">{fmt.date(t.date)}</div>
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={() => navigate('transactions', { category: NEEDS_REVIEW })}>
            Review transactions
          </Button>
        </div>
      )}
    </Card>
  )
}

function dueText(p: UpcomingPayment): { text: string; late: boolean } {
  if (p.daysUntil === 0) return { text: 'Expected today', late: false }
  if (p.daysUntil === 1) return { text: 'Expected tomorrow', late: false }
  if (p.daysUntil > 1) return { text: `Expected in ${p.daysUntil} days`, late: false }
  const n = Math.abs(p.daysUntil)
  return { text: `Expected ${n} day${n === 1 ? '' : 's'} ago — not seen yet`, late: true }
}

export function UpcomingRecurringCard({ items }: { items: UpcomingPayment[] }) {
  const { fmt, navigate } = useApp()
  return (
    <Card
      title="Upcoming recurring payments"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('recurring')}>
          Manage <ArrowRight size={14} aria-hidden />
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState compact icon={Repeat} title="Nothing upcoming">
          Keep a detected recurring payment to see it here.
        </EmptyState>
      ) : (
        <ul className="mini-list">
          {items.map((p) => {
            const due = dueText(p)
            return (
              <li key={p.key}>
                <div className="primary truncate" title={p.merchant}>
                  {p.merchant}
                </div>
                <div className="amount">{fmt.money(p.averageAmount)}</div>
                <div className={`secondary${due.late ? ' due-soon' : ''}`}>
                  {fmt.date(p.nextDate)} · {due.text}
                </div>
                <div className="secondary" style={{ textAlign: 'right' }}>
                  {p.cadence}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export function SubscriptionsCard({ data }: { data: DashboardData }) {
  const { fmt, navigate } = useApp()
  const { items, monthlyTotal } = data.subscriptions
  return (
    <Card
      title="Subscriptions"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('subscriptions')}>
          Manage <ArrowRight size={14} aria-hidden />
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState compact icon={Repeat} title="No subscriptions kept yet">
          Ledgerly suggests subscriptions once there is enough history. Keep the ones that are right and they appear here.
        </EmptyState>
      ) : (
        <>
          <ul className="mini-list">
            {items.slice(0, 6).map((s) => (
              <li key={s.key}>
                <div className="primary truncate" title={s.merchant}>
                  {s.merchant}
                </div>
                <div className="amount">{fmt.money(s.monthlyCost)}</div>
                <div className="secondary">
                  {fmt.money(s.averageAmount)} {s.cadence}
                </div>
                <div className="secondary" style={{ textAlign: 'right' }}>
                  per month
                </div>
              </li>
            ))}
          </ul>
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="dash-note">
              {items.length} kept subscription{items.length === 1 ? '' : 's'}
            </span>
            <strong>{fmt.money(monthlyTotal)} / month</strong>
          </div>
        </>
      )}
    </Card>
  )
}
