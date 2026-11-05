import { useCallback, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { PERIODS, type PeriodId } from '@shared/types'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toasts'
import { api, errorMessage } from '@/services/api'
import { csvFilename, toCsv } from './csv'
import './reports.css'

export const periodLabel = (p: PeriodId): string => PERIODS.find((x) => x.id === p)?.label ?? p

/** Title + description + "Export CSV" for one report. */
export function ReportHead({ title, description, onExport, exporting }: {
  title: string
  description?: ReactNode
  onExport?: () => void
  exporting?: boolean
}) {
  return (
    <div className="report-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {onExport && (
        <Button icon={Download} onClick={onExport} loading={exporting} title="Save this report as a CSV file on this computer">
          Export CSV
        </Button>
      )}
    </div>
  )
}

/** Returns a function that saves `headers`/`rows` as a CSV through the native Save dialog. */
export function useCsvExport(report: string, period: PeriodId) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (headers: string[], rows: (string | number)[][]) => {
      if (rows.length === 0) {
        toast.error('There is nothing to export for this period.')
        return
      }
      setBusy(true)
      try {
        const res = await api.reports.saveCsv({ filename: csvFilename(report, period), content: toCsv(headers, rows) })
        if (res.saved) toast.success('Report exported as CSV.')
      } catch (e) {
        toast.error(errorMessage(e))
      } finally {
        setBusy(false)
      }
    },
    [report, period, toast]
  )
  return { exportCsv: run, exporting: busy }
}

/** Keep the largest `n` rows and fold the remainder into one muted "Other" row. */
export function foldRows<T extends { total: number; count: number; pct: number }>(
  rows: T[],
  n: number,
  make: (total: number, count: number, pct: number, hidden: number) => T
): T[] {
  if (rows.length <= n + 1) return rows
  const tail = rows.slice(n)
  const total = tail.reduce((s, r) => s + r.total, 0)
  const count = tail.reduce((s, r) => s + r.count, 0)
  const pct = Math.round(tail.reduce((s, r) => s + r.pct, 0) * 10) / 10
  return [...rows.slice(0, n), make(Math.round(total * 100) / 100, count, pct, tail.length)]
}
