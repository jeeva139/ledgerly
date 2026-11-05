import type { Insight } from '@shared/api/reports'
import { categoryLabel, type PeriodId } from '@shared/types'

/** How a sentence refers to the selected period. */
export function periodPhrase(period: PeriodId): string {
  switch (period) {
    case 'all-time':
      return 'overall'
    case 'this-month':
      return 'this month'
    case 'last-month':
      return 'last month'
    case 'last-3-months':
      return 'in the last 3 months'
    case 'last-6-months':
      return 'in the last 6 months'
    case 'this-year':
      return 'this year'
  }
}

export interface InsightText {
  id: string
  text: string
  tone: 'info' | 'warning'
  /** Optional call to action understood by the dashboard. */
  action?: 'review'
}

/** Turn a structured, data-backed insight into one plain sentence. */
export function describeInsight(i: Insight, period: PeriodId, money: (n: number) => string): InsightText {
  const when = periodPhrase(period)
  switch (i.id) {
    case 'needs-review':
      return {
        id: i.id,
        tone: 'warning',
        action: 'review',
        text: `You have ${i.count.toLocaleString()} transaction${i.count === 1 ? '' : 's'} marked Needs review.`
      }
    case 'top-category':
      return {
        id: i.id,
        tone: 'info',
        text: `${categoryLabel(i.category)} is your highest spending category ${when} — ${money(i.total)}, ${i.sharePct}% of spending.`
      }
    case 'spending-change': {
      const against = i.basis === 'same-days-last-month' ? 'the same days last month' : 'the month before'
      return {
        id: i.id,
        tone: 'info',
        text:
          i.direction === 'same'
            ? `Spending is about the same as ${against}.`
            : `Spending is ${i.direction} ${i.pct}% compared with ${against} (${money(i.current)} vs ${money(i.previous)}).`
      }
    }
    case 'spending-exceeds-income':
      return { id: i.id, tone: 'warning', text: `You spent ${money(i.shortfall)} more than you earned ${when}.` }
    case 'no-income':
      return { id: i.id, tone: 'info', text: `No income is recorded ${when}, so a savings rate cannot be worked out.` }
  }
}
