import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'

export function Spinner({ large, label = 'Loading' }: { large?: boolean; label?: string }) {
  return <span className={`spinner${large ? ' lg' : ''}`} role="status" aria-label={label} />
}

/** Page/section level loading indicator. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty compact" role="status" aria-live="polite">
      <Spinner large label={label} />
      <span>{label}</span>
    </div>
  )
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      <div className="empty-icon">
        <Icon size={26} aria-hidden />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}

type AlertKind = 'info' | 'warning' | 'danger' | 'success'
const ALERT_ICON: Record<AlertKind, LucideIcon> = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }

export function Alert({ kind = 'info', children, action }: { kind?: AlertKind; children: ReactNode; action?: ReactNode }) {
  const Icon = ALERT_ICON[kind]
  return (
    <div className={`alert ${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div className="alert-body grow">{children}</div>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty compact">
      <Alert kind="danger" action={onRetry ? <button className="btn sm" onClick={onRetry}>Try again</button> : undefined}>
        {message}
      </Alert>
    </div>
  )
}

export function ProgressBar({ value, max = 100, tone, label }: { value: number; max?: number; tone?: 'positive' | 'spending' | 'danger'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Pill({ tone, children, title }: { tone?: 'accent' | 'positive' | 'spending' | 'info' | 'danger' | 'warning'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone ?? ''}`} title={title}>
      {children}
    </span>
  )
}
