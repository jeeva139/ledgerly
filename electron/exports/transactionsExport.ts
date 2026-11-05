// Export transactions to CSV / Excel / QIF. Files are written locally through a native "Save as" dialog;
// nothing is ever uploaded. Filters decide which rows are exported.
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/db'
import { paths } from '../database/paths'
import { TXN_COLUMNS, rowToTransaction, type TxnRow } from '../database/txnStore'
import { dialogs } from '../platform/dialogs'
import { listAccounts } from '../services/catalog'
import { buildWhere, type Where } from '../services/transactions'
import { AppError } from '../../shared/errors'
import { todayISO } from '../../shared/dates'
import type { Transaction } from '../../shared/types'
import type { ExportFormat, ExportResult, TransactionFilters } from '../../shared/api/transactions'

const HEADER = ['Date', 'Description', 'Memo', 'Category', 'Account', 'Type', 'Amount', 'Tags', 'Transfer', 'Reference']
const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  csv: { name: 'CSV file', extensions: ['csv'] },
  xlsx: { name: 'Excel workbook', extensions: ['xlsx'] },
  qif: { name: 'QIF file (Quicken)', extensions: ['qif'] }
}

/** Chronological order, stable. */
const EXPORT_ORDER = 'date ASC, createdAt ASC, id ASC'

function* iterateRows(where: Where): Generator<Transaction> {
  const db = getDb()
  for (const r of db.iterate<TxnRow>(`SELECT ${TXN_COLUMNS} FROM transactions WHERE ${where.sql} ORDER BY ${EXPORT_ORDER}`, ...where.params)) {
    yield rowToTransaction(r)
  }
}

const signed = (t: Transaction) => (t.type === 'expense' ? -t.amount : t.amount)

// ---- CSV --------------------------------------------------------------------------------------

/** Quote when needed; neutralise spreadsheet formula injection in text columns. */
export function csvText(value: string): string {
  let v = value
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function csvLine(t: Transaction): string {
  return [
    t.date,
    csvText(t.merchant),
    csvText(t.memo),
    csvText(t.category),
    csvText(t.account),
    t.type,
    signed(t).toFixed(2),
    csvText(t.tags.join('; ')),
    t.isTransfer ? 'Yes' : 'No',
    csvText(t.reference)
  ].join(',')
}

function writeCsv(file: string, rows: Iterable<Transaction>): number {
  const fd = fs.openSync(file, 'w')
  let count = 0
  try {
    fs.writeSync(fd, '﻿' + HEADER.join(',') + '\r\n') // UTF-8 BOM so Excel reads ₹ and accents correctly
    let buf: string[] = []
    for (const t of rows) {
      buf.push(csvLine(t))
      count++
      if (buf.length >= 2000) {
        fs.writeSync(fd, buf.join('\r\n') + '\r\n')
        buf = []
      }
    }
    if (buf.length) fs.writeSync(fd, buf.join('\r\n') + '\r\n')
  } finally {
    fs.closeSync(fd)
  }
  return count
}

// ---- QIF --------------------------------------------------------------------------------------

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
/** MM/DD/YYYY — the de-facto QIF date format. */
const qifDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`

export function qifRecord(t: Transaction): string {
  const lines = [`D${qifDate(t.date)}`, `T${signed(t).toFixed(2)}`, `P${oneLine(t.merchant)}`]
  if (t.memo) lines.push(`M${oneLine(t.memo)}`)
  if (t.category) lines.push(`L${oneLine(t.category)}`)
  if (t.reference) lines.push(`N${oneLine(t.reference)}`)
  lines.push('^')
  return lines.join('\r\n')
}

function qifSectionType(accountType: string | undefined): string {
  if (accountType === 'credit-card') return 'CCard'
  if (accountType === 'cash') return 'Cash'
  return 'Bank'
}

function writeQif(file: string, rows: Iterable<Transaction>): number {
  const accountTypes = new Map(listAccounts().map((a) => [a.name.toLowerCase(), a.type]))
  // Group by account so each account gets its own QIF section (QIF has no per-record account field).
  const byAccount = new Map<string, Transaction[]>()
  let count = 0
  for (const t of rows) {
    const list = byAccount.get(t.account) ?? []
    list.push(t)
    byAccount.set(t.account, list)
    count++
  }
  const fd = fs.openSync(file, 'w')
  try {
    for (const [account, list] of byAccount) {
      const type = qifSectionType(accountTypes.get(account.toLowerCase()))
      fs.writeSync(fd, `!Account\r\nN${oneLine(account)}\r\nT${type}\r\n^\r\n!Type:${type}\r\n`)
      let buf: string[] = []
      for (const t of list) {
        buf.push(qifRecord(t))
        if (buf.length >= 2000) {
          fs.writeSync(fd, buf.join('\r\n') + '\r\n')
          buf = []
        }
      }
      if (buf.length) fs.writeSync(fd, buf.join('\r\n') + '\r\n')
    }
  } finally {
    fs.closeSync(fd)
  }
  return count
}

// ---- XLSX -------------------------------------------------------------------------------------

async function writeXlsx(file: string, rows: Iterable<Transaction>): Promise<number> {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [HEADER]
  for (const t of rows) {
    aoa.push([t.date, t.merchant, t.memo, t.category, t.account, t.type, signed(t), t.tags.join('; '), t.isTransfer ? 'Yes' : 'No', t.reference])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 44 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 9 }, { wch: 14 }, { wch: 22 }, { wch: 9 }, { wch: 16 }]
  const amountCol = HEADER.indexOf('Amount')
  for (let r = 1; r < aoa.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: amountCol })]
    if (cell) cell.z = '#,##0.00'
  }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: HEADER.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
  fs.writeFileSync(file, buf)
  return aoa.length - 1
}

// ---- entry point ------------------------------------------------------------------------------

export function countForExport(filters: TransactionFilters): number {
  const where = buildWhere(filters)
  return getDb().scalar<number>(`SELECT COUNT(*) FROM transactions WHERE ${where.sql}`, ...where.params) ?? 0
}

export async function exportTransactions(format: ExportFormat, filters: TransactionFilters = {}): Promise<ExportResult> {
  const expected = countForExport(filters)
  if (expected === 0) throw new AppError('VALIDATION', 'There are no transactions to export with the current filters.')

  const defaultName = `Ledgerly_Transactions_${todayISO()}.${format}`
  const target = await dialogs().saveFile({
    title: 'Export transactions',
    defaultPath: path.join(paths.exports(), defaultName),
    filters: [FILTERS[format]]
  })
  if (!target) return { saved: false, count: 0, fileName: null }

  const where = buildWhere(filters)
  const tmp = `${target}.part`
  try {
    let count: number
    const rows = iterateRows(where)
    if (format === 'csv') count = writeCsv(tmp, rows)
    else if (format === 'qif') count = writeQif(tmp, rows)
    else count = await writeXlsx(tmp, rows)
    fs.renameSync(tmp, target)
    return { saved: true, count, fileName: path.basename(target) }
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    if (e instanceof AppError) throw e
    throw new AppError('IO', 'Ledgerly could not write the export file. Check that the location is writable and try again.')
  }
}
