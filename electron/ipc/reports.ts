// Dashboard & Reports — IPC handlers (read-only analytics; the only side effect is saving a CSV file the user chose).
import { z } from 'zod'
import { handle } from './register'
import { periodId } from './schemas'
import { getDashboard } from '../services/dashboard'
import { accountsReport, categoryTrends, monthlyReport, saveCsv, spendingByCategory, tagsReport, topMerchants } from '../services/reports'

const periodInput = z.object({ period: periodId })

export function registerReportsIpc(): void {
  handle('dashboard.get', periodInput, ({ period }) => getDashboard(period))

  handle('reports.spendingByCategory', z.object({ period: periodId, rollUp: z.boolean().optional() }), ({ period, rollUp }) =>
    spendingByCategory(period, rollUp ?? true)
  )
  handle('reports.monthly', periodInput, ({ period }) => monthlyReport(period))
  handle('reports.categoryTrends', z.object({ period: periodId, top: z.number().int().min(1).max(10).optional() }), ({ period, top }) =>
    categoryTrends(period, top ?? 5)
  )
  handle('reports.topMerchants', z.object({ period: periodId, limit: z.number().int().min(1).max(100).optional() }), ({ period, limit }) =>
    topMerchants(period, limit ?? 15)
  )
  handle('reports.accounts', periodInput, ({ period }) => accountsReport(period))
  handle('reports.tags', periodInput, ({ period }) => tagsReport(period))
  handle(
    'reports.saveCsv',
    z.object({
      filename: z.string().min(1).max(120),
      content: z.string().min(1, 'There is nothing to export.').max(5_000_000)
    }),
    ({ filename, content }) => saveCsv(filename, content)
  )
}
