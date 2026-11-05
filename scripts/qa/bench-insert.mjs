// Dev benchmark: where does insertBatch spend its time on a large table?
import esbuild from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-build-'))
const rp = (p) => path.join(root, p).split(path.sep).join('/')
fs.writeFileSync(path.join(tmp, 'e.ts'), `
export { setDataDir, ensureDataLayout } from '${rp('electron/database/paths')}'
export { openDatabase, closeDatabase, getDb } from '${rp('electron/database/db')}'
export { insertBatch, baseFingerprint, validateNewTransaction, TXN_COLUMNS } from '${rp('electron/database/txnStore')}'
export { seedDefaultsIfNeeded } from '${rp('electron/services/settings')}'
export { newId, nowISO } from '${rp('electron/database/ids')}'`)
await esbuild.build({ entryPoints: [path.join(tmp, 'e.ts')], outfile: path.join(tmp, 'b.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'node:*'], logLevel: 'error' })
const lib = createRequire(import.meta.url)(path.join(tmp, 'b.cjs'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-data-'))
lib.setDataDir(dir); lib.ensureDataLayout(); lib.openDatabase(); lib.seedDefaultsIfNeeded()
let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const mk = (n) => Array.from({ length: n }, (_, i) => {
  const date = `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
  const merchant = `UPI-NAME-${Math.floor(rnd() * 9e9)}-X@YBL-CIUB0000476-${Math.floor(rnd() * 9e11)}-LUNCHUPI-${n}${i}${Math.floor(rnd() * 1e9)}`
  const amount = Math.round(rnd() * 100000) / 100 + 1
  return { date, merchant, amount, type: 'expense', account: 'Cash', source: 'qa', fingerprint: lib.baseFingerprint(date, merchant, amount, 'Cash') }
})
const time = (label, fn) => { const t = performance.now(); const r = fn(); console.log(label.padEnd(46), Math.round(performance.now() - t) + ' ms'); return r }
for (let b = 0; b < 8; b++) lib.insertBatch(mk(5000))            // warm table to 40k rows
console.log('table rows:', lib.getDb().scalar('SELECT COUNT(*) FROM transactions'))
const rows = mk(5000)
time('validateNewTransaction x5000 (no DB)', () => rows.forEach((r) => lib.validateNewTransaction(r)))
const db = lib.getDb()
const sql = `INSERT INTO transactions (${lib.TXN_COLUMNS}, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`
const raw = mk(5000)
time('raw prepared insert x5000 in one txn', () => db.transaction(() => raw.forEach((r) => db.run(sql, lib.newId(), r.date, r.merchant, '', 'Needs review', r.amount, 'expense', 'Cash', '[]', 0, null, 'qa', 0, 0, '', null, lib.nowISO(), lib.nowISO(), r.fingerprint))))
time('insertBatch x5000 (full path)', () => lib.insertBatch(mk(5000)))
lib.closeDatabase()
