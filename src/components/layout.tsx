import { useId, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { Button } from './Button'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, actions, children, flush, dark, className = '' }: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  dark?: boolean
  className?: string
}) {
  return (
    <section className={`card${flush ? ' flush' : ''}${dark ? ' dark' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-head" style={flush ? { padding: '16px 20px 0' } : undefined}>
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone, dark, notSet }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  tone?: 'accent' | 'positive' | 'spending' | 'info'
  dark?: boolean
  /** Show the value as a muted "not set" state. */
  notSet?: boolean
}) {
  const toneBg: Record<string, string> = {
    accent: 'var(--accent-soft)',
    positive: 'var(--positive-soft)',
    spending: 'var(--spending-soft)',
    info: 'var(--info-soft)'
  }
  const toneFg: Record<string, string> = {
    accent: 'var(--accent-text)',
    positive: 'var(--positive-text)',
    spending: 'var(--spending-text)',
    info: 'var(--info-text)'
  }
  return (
    <section className={`card${dark ? ' dark' : ''}`}>
      <div className="stat">
        <div className="label">
          {Icon && (
            <span
              className="dot"
              style={dark ? { background: 'rgba(255,255,255,0.12)', color: '#fff' } : { background: toneBg[tone ?? 'accent'], color: toneFg[tone ?? 'accent'] }}
            >
              <Icon size={16} aria-hidden />
            </span>
          )}
          {label}
        </div>
        <div className={`value${notSet ? ' not-set' : ''}`}>{value}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </section>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: {
  value: T
  onChange: (v: T) => void
  tabs: { id: T; label: ReactNode }[]
  label: string
}) {
  const base = useId()
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} id={`${base}-${t.id}`} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, sizes = [50, 100, 250] }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize?: (n: number) => void
  sizes?: number[]
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="pager">
      <span>
        {total === 0 ? 'No results' : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <div className="row">
        {onPageSize && (
          <label className="row small" style={{ gap: 6 }}>
            Rows
            <select className="select sm" style={{ width: 76 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          Prev
        </Button>
        <span className="nowrap">
          Page {page.toLocaleString()} of {pages.toLocaleString()}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight size={15} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
