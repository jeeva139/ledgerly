import fs from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupDataDir, teardownDataDir } from './fileDb'
import { getDb } from '../electron/database/db'
import { paths } from '../electron/database/paths'
import { insertTransaction } from '../electron/database/txnStore'
import { deleteDocument, getDocument, sanitizeFilename, storeDocument } from '../electron/documents/vault'
import { extractDocument, extractPdfText, findDate, findTotal, parseReceiptText, STATEMENT_MESSAGE, UNAVAILABLE_MESSAGE } from '../electron/documents/extract'
import { setDialogProvider } from '../electron/platform/dialogs'
import { registerDocumentsIpc } from '../electron/ipc/documents'
import { registerBackupIpc } from '../electron/ipc/backup'
import { missingHandlers } from '../electron/ipc'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { DOCUMENT_MAX_BYTES, type DocumentRecord } from '../shared/types'

let dir: string
beforeEach(() => {
  dir = setupDataDir('ledgerly-docs')
  clearHandlersForTests()
  registerDocumentsIpc()
})
afterEach(() => teardownDataDir(dir))

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))
const NOW = new Date(2026, 10, 5)

const RECEIPT = `Sunrise Cafe
12 MG Road, Bengaluru
Date: 14/10/2026
Masala Dosa 90.00
Filter Coffee 60.00
Subtotal 150.00
GST 5% 7.50
Total 157.50
Thank you!`

describe('vault storage', () => {
  it('stores original bytes under the right sub-folder and never exposes the raw path', () => {
    const doc = storeDocument({ filename: 'Lunch receipt.png', bytes: new Uint8Array([1, 2, 3, 4]), kind: 'receipt', source: 'upload' })
    expect(doc).toMatchObject({ filename: 'Lunch receipt.png', mimeType: 'image/png', size: 4, kind: 'receipt', status: 'stored', source: 'upload' })
    expect(JSON.stringify(doc)).not.toMatch(/objectPath|receipts[\\/]/)
    const row = getDb().get<{ objectPath: string }>('SELECT objectPath FROM documents WHERE id = ?', doc.id)!
    expect(row.objectPath.startsWith('receipts/')).toBe(true)
    expect([...fs.readFileSync(path.join(paths.documents(), ...row.objectPath.split('/')))]).toEqual([1, 2, 3, 4])
  })

  it('enforces the 20 MB limit with a readable error and never truncates', () => {
    const exactly = new Uint8Array(DOCUMENT_MAX_BYTES)
    expect(storeDocument({ filename: 'edge.pdf', bytes: exactly, source: 'upload' }).size).toBe(DOCUMENT_MAX_BYTES)
    expect(() => storeDocument({ filename: 'big.pdf', bytes: new Uint8Array(DOCUMENT_MAX_BYTES + 1), source: 'upload' })).toThrow(/20 MB/)
    expect(getDb().scalar('SELECT COUNT(*) FROM documents')).toBe(1)
    expect(fs.readdirSync(path.join(paths.documents(), 'other')).filter((f) => f.includes('big'))).toEqual([])
  })

  it('rejects unsupported and empty files', () => {
    expect(() => storeDocument({ filename: 'virus.exe', bytes: bytes('x'), source: 'upload' })).toThrow(/not a supported file type/)
    expect(() => storeDocument({ filename: 'empty.pdf', bytes: new Uint8Array(0), source: 'upload' })).toThrow(/empty/)
  })

  it('sanitises hostile file names', () => {
    expect(sanitizeFilename('..\\..\\windows\\evil?.pdf')).toBe('evil_.pdf')
    expect(sanitizeFilename('/etc/passwd.txt')).toBe('passwd.txt')
    const doc = storeDocument({ filename: '../../outside.txt', bytes: bytes('hi'), source: 'upload' })
    expect(doc.filename).toBe('outside.txt')
    expect(fs.existsSync(path.join(dir, 'outside.txt'))).toBe(false)
  })

  it('delete removes the file and row and clears receipt links on transactions', () => {
    const doc = storeDocument({ filename: 'r.pdf', bytes: bytes('%PDF-1.4'), kind: 'receipt', source: 'upload' })
    const t = insertTransaction({ date: '2026-03-01', merchant: 'Cafe', amount: 5, type: 'expense', account: 'Cash', source: 'manual', receiptDocId: doc.id })
    expect(t.receipt).toBe(true)
    deleteDocument(doc.id)
    expect(getDocument(doc.id)).toBeNull()
    expect(fs.readdirSync(path.join(paths.documents(), 'receipts'))).toEqual([])
    const row = getDb().get<{ receipt: number; receiptDocId: string | null }>('SELECT receipt, receiptDocId FROM transactions WHERE id = ?', t.id)!
    expect(row).toEqual({ receipt: 0, receiptDocId: null })
  })
})

describe('documents IPC', () => {
  const upload = (filename: string, content: string, extra: Record<string, unknown> = {}) =>
    callChannel<DocumentRecord>('documents.uploadBytes', { filename, bytes: bytes(content), ...extra })

  it('lists with search, kind/status filters and pagination', async () => {
    await upload('alpha receipt.txt', 'hello', { kind: 'receipt' })
    await upload('beta invoice.txt', 'hello', { kind: 'invoice' })
    await upload('gamma.csv', 'a,b\n1,2')
    expect((await callChannel<{ total: number }>('documents.list')).total).toBe(3)
    expect((await callChannel<{ rows: DocumentRecord[] }>('documents.list', { search: 'ALPHA' })).rows.map((r) => r.filename)).toEqual(['alpha receipt.txt'])
    expect((await callChannel<{ total: number }>('documents.list', { kind: 'invoice' })).total).toBe(1)
    expect((await callChannel<{ total: number }>('documents.list', { kind: 'spreadsheet' })).total).toBe(1)
    const page = await callChannel<{ rows: DocumentRecord[]; total: number }>('documents.list', { page: 2, pageSize: 2 })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(3)
    expect((await callChannel<{ total: number }>('documents.list', { search: '%' })).total).toBe(0) // LIKE wildcards are escaped
  })

  it('rejects oversize bytes with a readable message and stores nothing', async () => {
    const res = await invokeChannel('documents.uploadBytes', { filename: 'huge.pdf', bytes: new Uint8Array(DOCUMENT_MAX_BYTES + 5) })
    expect(res).toMatchObject({ ok: false, error: { code: 'LIMIT' } })
    expect((res as { error: { message: string } }).error.message).toMatch(/20 MB/)
    expect(await callChannel('documents.list')).toMatchObject({ total: 0 })
  })

  it('validates input', async () => {
    expect(await invokeChannel('documents.uploadBytes', { filename: 'x.txt', bytes: 'not bytes' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('documents.get', { id: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await invokeChannel('documents.update', { id: 'x', kind: 'weird' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('updates note, kind (moving the file) and status', async () => {
    const doc = await upload('moving.pdf', '%PDF-1.4 hello', { kind: 'receipt' })
    const updated = await callChannel<DocumentRecord>('documents.update', { id: doc.id, note: '  taxi to airport ', kind: 'invoice', status: 'review' })
    expect(updated).toMatchObject({ note: 'taxi to airport', kind: 'invoice', status: 'review' })
    expect(fs.readdirSync(path.join(paths.documents(), 'receipts'))).toEqual([])
    expect(fs.readdirSync(path.join(paths.documents(), 'invoices'))).toHaveLength(1)
    await callChannel('documents.delete', { id: doc.id })
    expect(fs.readdirSync(path.join(paths.documents(), 'invoices'))).toEqual([])
  })

  it('native dialog upload stores valid files and reports each rejected file with a reason', async () => {
    const good = path.join(dir, 'good.txt')
    const bad = path.join(dir, 'bad.exe')
    const big = path.join(dir, 'big.pdf')
    fs.writeFileSync(good, 'Cafe\nDate: 2026-10-01\nTotal 20.00')
    fs.writeFileSync(bad, 'MZ')
    fs.writeFileSync(big, Buffer.alloc(DOCUMENT_MAX_BYTES + 1))
    setDialogProvider({
      openFile: async () => [good, bad, big],
      saveFile: async () => null,
      openPath: async () => '',
      openFolder: async () => ''
    })
    const res = await callChannel<{ added: DocumentRecord[]; rejected: { filename: string; reason: string }[]; cancelled: boolean }>('documents.upload', { kind: 'receipt' })
    expect(res.cancelled).toBe(false)
    expect(res.added.map((d) => d.filename)).toEqual(['good.txt'])
    expect(res.rejected.map((r) => r.filename).sort()).toEqual(['bad.exe', 'big.pdf'])
    expect(res.rejected.find((r) => r.filename === 'big.pdf')!.reason).toMatch(/20 MB/)
    expect(res.rejected.find((r) => r.filename === 'bad.exe')!.reason).toMatch(/supported/)
    expect(JSON.stringify(res)).not.toContain(dir.replace(/\\/g, '\\\\'))
  })

  it('cancelling the dialog is not an error', async () => {
    setDialogProvider({ openFile: async () => null, saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    expect(await callChannel('documents.upload')).toEqual({ added: [], rejected: [], cancelled: true })
  })

  it('open uses the default app; saveCopy writes an identical copy; missing app surfaces a friendly error', async () => {
    const doc = await upload('copy-me.txt', 'original contents')
    const opened: string[] = []
    const copy = path.join(dir, 'copy.txt')
    setDialogProvider({ openFile: async () => null, saveFile: async () => copy, openPath: async (p) => (opened.push(p), ''), openFolder: async () => '' })
    await callChannel('documents.open', { id: doc.id })
    expect(opened).toHaveLength(1)
    expect(await callChannel('documents.saveCopy', { id: doc.id })).toBe(true)
    expect(fs.readFileSync(copy, 'utf8')).toBe('original contents')
    setDialogProvider({ openFile: async () => null, saveFile: async () => null, openPath: async () => 'No application is associated', openFolder: async () => '' })
    expect(await invokeChannel('documents.open', { id: doc.id })).toMatchObject({ ok: false, error: { code: 'IO' } })
    expect(await callChannel('documents.saveCopy', { id: doc.id })).toBe(false)
  })

  it('statement files are queued for import; text receipts become "review" with extracted values', async () => {
    const stmt = await upload('bank.csv', 'Date,Desc,Amount\n2026-01-01,X,5', { extract: true })
    expect(stmt.status).toBe('queued')
    expect(stmt.extracted?.message).toBe(STATEMENT_MESSAGE)
    const receipt = await upload('cafe.txt', RECEIPT, { kind: 'receipt', extract: true })
    expect(receipt.status).toBe('review')
    expect(receipt.extracted).toMatchObject({ merchant: 'Sunrise Cafe', amount: 157.5, type: 'expense' })
    // not extracting by default keeps attach-a-receipt lightweight
    const plain = await upload('cafe2.txt', RECEIPT, { kind: 'receipt' })
    expect(plain.status).toBe('stored')
    expect(plain.extracted).toBeNull()
  })

  it('images report that extraction is unavailable and never invent values', async () => {
    const img = await upload('photo.jpg', 'fake jpeg bytes', { kind: 'receipt', extract: true })
    expect(img.status).toBe('stored')
    expect(img.extracted).toEqual({ merchant: null, date: null, amount: null, type: null, category: null, message: UNAVAILABLE_MESSAGE })
    const again = await callChannel<{ merchant: string | null; message: string }>('documents.extract', { id: img.id })
    expect(again.merchant).toBeNull()
    expect(again.message).toMatch(/unavailable/)
  })

  it('extraction can suggest a category only from the user’s own saved rules', async () => {
    getDb().run("INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt) VALUES ('r1','sunrise','Dining',1,'t','t')")
    const doc = await upload('cafe.txt', RECEIPT, { kind: 'receipt', extract: true })
    expect(doc.extracted?.category).toBe('Dining')
    getDb().run('DELETE FROM rules')
    const rerun = await callChannel<{ category: string | null }>('documents.extract', { id: doc.id })
    expect(rerun.category).toBeNull()
  })

  it('registers every documents/backup/data channel of the shared contract', () => {
    registerBackupIpc()
    expect(missingHandlers().filter((c) => /^(documents|backup|data)\./.test(c))).toEqual([])
  })
})

describe('receipt text parsing (offline heuristics)', () => {
  it('reads merchant, date and total; ignores subtotal and tax lines', () => {
    const r = parseReceiptText(RECEIPT, { kind: 'receipt', now: NOW })
    expect(r).toMatchObject({ merchant: 'Sunrise Cafe', date: '2026-10-14', amount: 157.5, type: 'expense', category: null })
    expect(r.message).toMatch(/Review required/)
  })

  it('prefers "grand total / amount due" lines and the right-most number on the line', () => {
    expect(findTotal(['Item 10.00', 'Total 10.00', 'Grand Total: Rs. 1,23,456.50'])).toBe(123456.5)
    expect(findTotal(['Subtotal 100.00', 'Total tax 18.00', 'Total Qty 3'])).toBeNull()
    expect(findTotal(['Amount due ₹ 2,499'])).toBe(2499)
  })

  it('resolves ambiguous d/m dates with the user’s preference and rejects impossible/future dates', () => {
    expect(findDate('Date 03/04/2026', 'DD/MM/YYYY', NOW)).toBe('2026-04-03')
    expect(findDate('Date 03/04/2026', 'MM/DD/YYYY', NOW)).toBe('2026-03-04')
    expect(findDate('13/04/2026', 'MM/DD/YYYY', NOW)).toBe('2026-04-13')
    expect(findDate('2026-10-31', 'DD/MM/YYYY', NOW)).toBe('2026-10-31')
    expect(findDate('3 Oct 2026', 'DD/MM/YYYY', NOW)).toBe('2026-10-03')
    expect(findDate('October 3, 2026', 'DD/MM/YYYY', NOW)).toBe('2026-10-03')
    expect(findDate('31/02/2026', 'DD/MM/YYYY', NOW)).toBeNull()
    expect(findDate('12/12/2031', 'DD/MM/YYYY', NOW)).toBeNull()
  })

  it('leaves everything empty when there is no evidence (never invents values)', () => {
    const r = parseReceiptText('Lorem ipsum dolor sit amet\nconsectetur adipiscing elit', { kind: 'receipt', now: NOW })
    expect(r).toMatchObject({ merchant: null, date: null, amount: null, type: null, category: null })
    expect(r.message).toMatch(/enter the transaction manually/)
  })

  it('invoices keep the type empty — only receipts are certainly expenses', () => {
    expect(parseReceiptText(RECEIPT, { kind: 'invoice', now: NOW }).type).toBeNull()
  })
})

// ---- a minimal but real PDF writer so the PDF reader is tested against actual PDF syntax -------
function pdf(objects: (string | Buffer)[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.5\n', 'latin1')]
  objects.forEach((o, i) => {
    parts.push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1'))
  })
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'))
  return new Uint8Array(Buffer.concat(parts))
}
const streamObj = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')])
const esc = (s: string) => s.replace(/([\\()])/g, '\\$1')

describe('PDF text layer', () => {
  const lines = RECEIPT.split('\n')
  const content = (op: (l: string) => string) => `BT /F1 12 Tf 14 TL 50 780 Td\n${lines.map((l) => op(l)).join(' T*\n')}\nET`

  it('reads plain literal strings from uncompressed content streams', () => {
    const file = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      streamObj('', Buffer.from(content((l) => `(${esc(l)}) Tj`), 'latin1')),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ])
    const text = extractPdfText(file)
    expect(text).toContain('Sunrise Cafe')
    expect(text).toContain('Total 157.50')
    const result = extractDocument({ filename: 'r.pdf', bytes: file, kind: 'receipt', now: NOW })
    expect(result).toMatchObject({ merchant: 'Sunrise Cafe', date: '2026-10-14', amount: 157.5 })
  })

  it('reads FlateDecode streams and TJ arrays', () => {
    const body = Buffer.from(content((l) => `[(${esc(l.slice(0, 3))}) -20 (${esc(l.slice(3))})] TJ`), 'latin1')
    const file = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      streamObj('/Filter /FlateDecode', deflateSync(body)),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ])
    expect(extractPdfText(file)).toContain('Sunrise Cafe')
    expect(extractDocument({ filename: 'r.pdf', bytes: file, kind: 'receipt', now: NOW }).amount).toBe(157.5)
  })

  it('decodes Type0 fonts through their ToUnicode map', () => {
    const chars = [...new Set(RECEIPT.replace(/\n/g, ''))]
    const code = new Map(chars.map((c, i) => [c, i + 1]))
    const hex4 = (n: number) => n.toString(16).padStart(4, '0')
    const cmap =
      `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chars.length} beginbfchar\n` +
      chars.map((c) => `<${hex4(code.get(c)!)}> <${hex4(c.charCodeAt(0))}>`).join('\n') +
      '\nendbfchar\nendcmap end end'
    const hexLine = (l: string) => `<${[...l].map((c) => hex4(code.get(c)!)).join('')}> Tj`
    const file = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F7 5 0 R >> >> /Contents 4 0 R >>',
      streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(content(hexLine).replace('/F1', '/F7'), 'latin1'))),
      '<< /Type /Font /Subtype /Type0 /BaseFont /Arial /Encoding /Identity-H /ToUnicode 6 0 R >>',
      streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(cmap, 'latin1')))
    ])
    const text = extractPdfText(file)
    expect(text).toContain('Sunrise Cafe')
    expect(extractDocument({ filename: 'r.pdf', bytes: file, kind: 'receipt', now: NOW })).toMatchObject({ merchant: 'Sunrise Cafe', amount: 157.5 })
  })

  it('scanned / non-text PDFs and garbage report extraction as unavailable', () => {
    const scanned = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
      streamObj('/Type /XObject /Subtype /Image /Filter /DCTDecode', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    ])
    expect(extractDocument({ filename: 's.pdf', bytes: scanned, kind: 'receipt' }).message).toBe(UNAVAILABLE_MESSAGE)
    expect(extractDocument({ filename: 'junk.pdf', bytes: bytes('not a pdf at all'), kind: 'receipt' }).message).toBe(UNAVAILABLE_MESSAGE)
  })
})
