import { useState } from 'react'
import { categoryLabel } from '@shared/types'
import { useApp } from '@/app/AppContext'
import './charts.css'

export interface RankedItem {
  key: string
  label: string
  value: number
  /** Share of the whole, 0–100 (shown as text, never colour-only). */
  pct?: number
  /** Secondary text, e.g. "12 transactions". */
  detail?: string
  /** Muted bar (used for the folded "Other" tail). */
  muted?: boolean
}

/**
 * Part-to-whole as ranked horizontal bars (largest first, one hue, one baseline). Each row carries its
 * name, bar, value and share as text; hover/focus shows the same details in a tooltip.
 */
export function RankedBars({ items, color, formatValue, unitLabel = '' }: {
  items: RankedItem[]
  /** Bar colour (a resolved colour or CSS variable). */
  color: string
  formatValue?: (n: number) => string
  unitLabel?: string
}) {
  const { fmt } = useApp()
  const [hover, setHover] = useState<string | null>(null)
  const format = formatValue ?? ((n: number) => fmt.money(n))
  const max = items.reduce((m, i) => Math.max(m, i.value), 0)
  return (
    <ul className="ranked" aria-label={unitLabel || 'Ranked list'}>
      {items.map((it) => {
        const width = max > 0 ? Math.max(1.5, (it.value / max) * 100) : 0
        const text = `${it.label}: ${format(it.value)}${it.pct !== undefined ? `, ${it.pct}%` : ''}${it.detail ? `, ${it.detail}` : ''}`
        return (
          <li
            key={it.key}
            className={`ranked-row${hover === it.key ? ' hover' : ''}`}
            tabIndex={0}
            title={text}
            aria-label={text}
            onPointerEnter={() => setHover(it.key)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(it.key)}
            onBlur={() => setHover(null)}
          >
            <span className="ranked-name truncate">{categoryLabel(it.label)}</span>
            <span className="ranked-track" aria-hidden>
              <span className="ranked-fill" style={{ width: `${width}%`, background: it.muted ? 'var(--chart-8)' : color }} />
            </span>
            <span className="ranked-value">
              <strong>{format(it.value)}</strong>
              {it.pct !== undefined && <span className="ranked-pct">{it.pct}%</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
