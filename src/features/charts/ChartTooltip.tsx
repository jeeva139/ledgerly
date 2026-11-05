export interface TooltipRow {
  name: string
  value: string
  color: string
  shape?: 'bar' | 'line'
}

interface PayloadEntry {
  name?: string | number
  value?: number | string | readonly (string | number)[]
  color?: string
  stroke?: string
  fill?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

interface Props {
  active?: boolean
  payload?: readonly PayloadEntry[]
  label?: string | number
  /** Heading shown above the rows (defaults to the axis label). */
  heading?: (label: string, payload: Record<string, unknown> | undefined) => string
  /** Format a numeric value. */
  formatValue: (n: number) => string
  /** Display name + key colour per series (by dataKey). */
  series: Record<string, { name: string; color: string; shape?: 'bar' | 'line' }>
  /** Extra rows appended after the plotted series (e.g. running total). */
  extra?: (payload: Record<string, unknown> | undefined) => TooltipRow[]
}

/**
 * One tooltip listing every series at the hovered X. The value leads (strong), the series name follows
 * (secondary); rows are keyed with a short stroke of the series colour. All text uses text tokens.
 */
export function ChartTooltip({ active, payload, label, heading, formatValue, series, extra }: Props) {
  if (!active || !payload || payload.length === 0) return null
  const first = payload[0].payload
  const rows: TooltipRow[] = []
  for (const p of payload) {
    const key = String(p.dataKey ?? '')
    const s = series[key]
    if (!s || typeof p.value !== 'number') continue
    rows.push({ name: s.name, value: formatValue(p.value), color: s.color, shape: s.shape })
  }
  if (extra) rows.push(...extra(first))
  if (rows.length === 0) return null
  const title = heading ? heading(String(label ?? ''), first) : String(label ?? '')
  return (
    <div className="chart-tooltip" role="status">
      <div className="chart-tooltip-title">{title}</div>
      {rows.map((r, i) => (
        <div className="chart-tooltip-row" key={`${r.name}-${i}`}>
          <span className={`tt-key ${r.shape === 'line' ? 'line' : ''}`} style={{ background: r.color }} aria-hidden />
          <span className="tt-value">{r.value}</span>
          <span className="tt-name">{r.name}</span>
        </div>
      ))}
    </div>
  )
}
