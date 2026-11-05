import { useState } from 'react'
import { Check, EyeOff, RotateCcw } from 'lucide-react'
import type { Cadence, RecurringItem, RecurringKind } from '@shared/api/recurring'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Pill } from '@/components/feedback'
import { CategoryLabel, Money } from '@/components/domain'
import { useToast } from '@/components/Toasts'
import { api, errorMessage } from '@/services/api'
import './recurring.css'

export type RecurringMode = 'suggested' | 'kept' | 'ignored'
type Decision = 'keep' | 'ignore' | 'restore'

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Yearly'
}

const KIND_LABEL: Record<RecurringKind, string> = { subscription: 'Subscription', bill: 'Bill', other: 'Other recurring' }
const KIND_TONE: Record<RecurringKind, 'accent' | 'info' | undefined> = { subscription: 'accent', bill: 'info', other: undefined }

/** Keep / Ignore / Restore with toast feedback and a per-row busy state. */
export function useRecurringDecisions() {
  const { bump } = useApp()
  const toast = useToast()
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const decide = async (item: RecurringItem, decision: Decision) => {
    setBusyKey(item.key)
    try {
      await api.recurring[decision]({ key: item.key })
      if (decision === 'keep') toast.success(`Keeping ${item.merchant}. It now counts towards your upcoming payments.`)
      else if (decision === 'ignore') toast.success(`Ignoring ${item.merchant}. You can restore it from the Ignored tab.`)
      else toast.success(`${item.merchant} moved back to suggestions.`)
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusyKey(null)
    }
  }
  return { busyKey, decide }
}

interface Props {
  items: RecurringItem[]
  mode: RecurringMode
  busyKey: string | null
  onDecide: (item: RecurringItem, decision: Decision) => void
  /** Show the Type column (hidden on the Subscriptions page where every row is a subscription). */
  showKind?: boolean
}

export function RecurringTable({ items, mode, busyKey, onDecide, showKind = true }: Props) {
  const { fmt } = useApp()
  return (
    <div className="table-wrap">
      <table className="table rec-table">
        <caption className="sr-only">Detected recurring payments</caption>
        <thead>
          <tr>
            <th scope="col">Payment</th>
            {showKind && <th scope="col">Type</th>}
            <th scope="col">Repeats</th>
            <th scope="col" className="num">Average</th>
            <th scope="col" className="num hide-md" title="How much the amount differs from payment to payment">Variation</th>
            <th scope="col" className="num hide-sm">Payments</th>
            <th scope="col" className="hide-sm">Last paid</th>
            <th scope="col">Next expected</th>
            <th scope="col">Confidence</th>
            <th scope="col" className="hide-md">Category</th>
            <th scope="col" className="num">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const busy = busyKey === i.key
            return (
              <tr key={i.key}>
                <td>
                  <div className="rec-name truncate" title={i.merchant}>
                    {i.merchant}
                  </div>
                  <div className="small muted truncate" title={i.account}>
                    {i.account}
                  </div>
                </td>
                {showKind && (
                  <td>
                    <Pill tone={KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Pill>
                  </td>
                )}
                <td className="nowrap">{CADENCE_LABEL[i.cadence]}</td>
                <td className="num">
                  <Money amount={i.averageAmount} />
                  <div className="small muted">Last {fmt.money(i.lastAmount)}</div>
                </td>
                <td className="num hide-md">{i.amountVariationPct.toFixed(1)}%</td>
                <td className="num hide-sm">{i.occurrences}</td>
                <td className="nowrap hide-sm">{fmt.date(i.lastDate)}</td>
                <td className="nowrap">{fmt.date(i.nextDate)}</td>
                <td>
                  {i.confidence === 'high' ? (
                    <Pill tone="positive" title="At least 3 payments, amounts within 12% and dates within 5 days of the usual rhythm">
                      High
                    </Pill>
                  ) : (
                    <Pill tone="info" title="Fewer payments, or amounts or dates that vary more">
                      Medium
                    </Pill>
                  )}
                </td>
                <td className="hide-md">
                  <CategoryLabel name={i.category} />
                </td>
                <td>
                  <div className="rec-actions">
                    {mode === 'suggested' && (
                      <>
                        <Button size="sm" variant="primary" icon={Check} loading={busy} onClick={() => onDecide(i, 'keep')} aria-label={`Keep ${i.merchant}`}>
                          Keep
                        </Button>
                        <Button size="sm" icon={EyeOff} disabled={busy} onClick={() => onDecide(i, 'ignore')} aria-label={`Ignore ${i.merchant}`}>
                          Ignore
                        </Button>
                      </>
                    )}
                    {mode === 'kept' && (
                      <>
                        <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => onDecide(i, 'restore')} aria-label={`Move ${i.merchant} back to suggestions`}>
                          Undo keep
                        </Button>
                        <Button size="sm" variant="ghost" icon={EyeOff} disabled={busy} onClick={() => onDecide(i, 'ignore')} aria-label={`Ignore ${i.merchant}`}>
                          Ignore
                        </Button>
                      </>
                    )}
                    {mode === 'ignored' && (
                      <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => onDecide(i, 'restore')} aria-label={`Restore ${i.merchant}`}>
                        Restore
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Honest explanation of how detection works (used on both pages). */
export function HowDetectionWorks({ subscriptionsOnly }: { subscriptionsOnly?: boolean }) {
  return (
    <details className="rec-disclosure">
      <summary>How detection works</summary>
      <div className="rec-disclosure-body">
        <p>
          Ledgerly looks at your own expense transactions on this computer — nothing is sent anywhere. It groups them by merchant (bank
          references and long numbers are ignored) and looks for payments that repeat at a regular rhythm: weekly, every two weeks, monthly,
          quarterly or yearly.
        </p>
        <ul>
          <li>
            {subscriptionsOnly ? 'Well-known subscription services' : 'Well-known subscription and bill names'} (for example Netflix, Spotify, rent,
            insurance) or payments in your own <em>Subscriptions</em>, <em>Housing</em>, <em>Utilities</em> or <em>Insurance</em> categories need
            two payments on a regular schedule, with amounts that differ by no more than 20% (35% for bills).
          </li>
          <li>
            Any other merchant needs at least three payments, a monthly or slower rhythm, and almost identical amounts (within 3%) — so regular
            shopping trips are not mistaken for recurring payments.
          </li>
          <li>Transfers and income are never counted.</li>
          <li>
            <strong>Nothing is confirmed automatically.</strong> Choose <em>Keep</em> for the payments you want to track or <em>Ignore</em> for the
            rest; you can change your mind at any time.
          </li>
        </ul>
      </div>
    </details>
  )
}
