import { useState, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { Card } from '@/components/layout'
import './charts.css'

export interface LegendItem {
  label: string
  color: string
  shape?: 'bar' | 'line'
}

export interface ChartTable {
  caption: string
  columns: { label: string; numeric?: boolean }[]
  rows: (string | number)[][]
  /** Optional totals row. */
  footer?: (string | number)[]
}

/** Accessible table twin of a chart: every value the chart (or its tooltip) shows is here. */
export function DataTable({ table }: { table: ChartTable }) {
  return (
    <div className="table-wrap chart-table">
      <table className="table">
        <caption className="sr-only">{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={table.columns[i]?.numeric ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {table.footer && (
          <tfoot>
            <tr>
              {table.footer.map((cell, i) => (
                <th key={i} scope={i === 0 ? 'row' : undefined} className={table.columns[i]?.numeric ? 'num' : undefined}>
                  {cell}
                </th>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`legend-key ${it.shape === 'line' ? 'line' : ''}`} style={{ background: it.color }} aria-hidden />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

interface ChartCardProps {
  title: string
  subtitle?: ReactNode
  /** The visual. Rendered inside a labelled region so it has a text alternative. */
  children: ReactNode
  /** Spoken summary of what the chart shows. */
  ariaLabel: string
  /** Legend is shown for two or more series (a single series is named by the title). */
  legend?: LegendItem[]
  /** Enables the Chart / Table switch. */
  table?: ChartTable
  actions?: ReactNode
  /** Keep the previous render visible, slightly faded, while data reloads. */
  refreshing?: boolean
  /** When set, shown instead of the chart (no legend, no table switch): an honest empty state. */
  empty?: ReactNode
  className?: string
}

export function ChartCard({ title, subtitle, children, ariaLabel, legend, table, actions, refreshing, empty, className = '' }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card
      className={`chart-card ${className}`}
      title={
        <div className="grow">
          <h2>{title}</h2>
          {subtitle && <div className="chart-sub">{subtitle}</div>}
        </div>
      }
      actions={
        <>
          {actions}
          {table && !empty && (
            <div className="seg sm" role="group" aria-label={`${title} view`}>
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')} title="Show chart">
                <BarChart3 size={14} aria-hidden /> <span className="seg-label">Chart</span>
              </button>
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} title="Show as table">
                <Table2 size={14} aria-hidden /> <span className="seg-label">Table</span>
              </button>
            </div>
          )}
        </>
      }
    >
      {empty ? (
        <div className={`chart-frame${refreshing ? ' stale' : ''}`}>{empty}</div>
      ) : view === 'table' && table ? (
        <div className={`chart-frame${refreshing ? ' stale' : ''}`}>
          <DataTable table={table} />
        </div>
      ) : (
        <>
          {legend && legend.length >= 2 && <Legend items={legend} />}
          <div className={`chart-frame${refreshing ? ' stale' : ''}`} role="img" aria-label={ariaLabel}>
            {children}
          </div>
        </>
      )}
    </Card>
  )
}

