// Seed a throwaway Ledgerly data folder with N synthetic transactions (QA / performance testing only).
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/qa/seed.mjs <dataDir> <count>
// Uses the application's own database + insert code (bundled with esbuild), so the file is a valid Ledgerly DB.
import esbuild from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const [dataDir, countArg = '1000'] = process.argv.slice(2)
if (!dataDir) throw new Error('usage: seed.mjs <dataDir> <count>')
const count = Number(countArg)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-seedbuild-'))
const entry = path.join(tmp, 'entry.ts')
const out = path.join(tmp, 'seed-bundle.cjs')
const rp = (p) => path.join(root, p).replace(/\\/g, '/')
fs.writeFileSync(
  entry,
  `export { setDataDir, ensureDataLayout } from '${rp('electron/database/paths')}'
   export { openDatabase, closeDatabase, getDb } from '${rp('electron/database/db')}'
   export { insertBatch, baseFingerprint } from '${rp('electron/database/txnStore')}'
   export { seedDefaultsIfNeeded } from '${rp('electron/services/settings')}'`
)
await esbuild.build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'node:*'], logLevel: 'error' })
const lib = createRequire(import.meta.url)(out)

lib.setDataDir(dataDir)
lib.ensureDataLayout()
lib.openDatabase()
if (process.env.QA_PRAGMA) lib.getDb().exec(process.env.QA_PRAGMA)
lib.seedDefaultsIfNeeded()

// Deterministic pseudo-random generator so runs are repeatable.
let s = 123456789
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = (a) => a[Math.floor(rnd() * a.length)]

const merchants = [
  ['SWIGGY', 'Dining', 140, 900], ['ZOMATO', 'Dining', 120, 800], ['BIG BAZAAR GROCERY', 'Groceries', 300, 4000],
  ['RELIANCE FRESH', 'Groceries', 200, 3000], ['UBER TRIP', 'Transportation', 90, 700], ['AMAZON PAY INDIA', 'Shopping', 200, 9000],
  ['NETFLIX.COM', 'Subscriptions', 649, 649], ['SPOTIFY INDIA', 'Subscriptions', 119, 119], ['BESCOM ELECTRICITY', 'Utilities', 800, 2500],
  ['AIRTEL POSTPAID', 'Utilities', 599, 599], ['APOLLO PHARMACY', 'Health', 100, 2500], ['INOX MOVIES', 'Entertainment', 250, 1200],
  ['HDFC LIFE INSURANCE', 'Insurance', 2400, 2400], ['HOUSE RENT', 'Housing', 18000, 18000], ['SALARY ACME CORP', 'Income', 65000, 65000]
]
const upiNames = ['MR A MANIKANDAN', 'RAMESH KUMAR', 'PRIYA S', 'ANNAPURNA TIFFIN', 'SARAVANA BHAVAN', 'TEA POINT', 'MURUGAN MESS', 'KUMAR STORES']
const upiNotes = ['LUNCH', 'TEA', 'DOSA', 'BRIYANI', 'DINNER', 'BREAKFAST', 'MISC', 'RENT SHARE', 'FUEL', 'GROCERY', 'PAYMENT']

const accounts = ['Main Checking', 'Everyday Visa', 'Rewards Card', 'Cash']
const start = new Date(2023, 0, 1).getTime()
const span = new Date(2026, 9, 31).getTime() - start
const iso = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const seen = new Map()
const rows = []
for (let i = 0; i < count; i++) {
  const date = iso(start + Math.floor(rnd() * span))
  let merchant, memo = '', category = 'Needs review', type = 'expense', amount
  if (rnd() < 0.35) {
    const name = pick(upiNames)
    merchant = `UPI-${name}-${String(Math.floor(rnd() * 9e9) + 1e9)}-${Math.floor(rnd() * 9)}@YBL-CIUB0000476-${String(Math.floor(rnd() * 9e11) + 1e11)}-${pick(upiNotes)}UPI-${name.replace(/ /g, '')}${Math.floor(rnd() * 99999)}OKAX-${pick(upiNotes)}`
    amount = Math.round((20 + rnd() * 600) * 100) / 100
  } else {
    const [m, cat, lo, hi] = pick(merchants)
    merchant = `${m} ${Math.floor(rnd() * 9000) + 100}`
    category = rnd() < 0.7 ? cat : 'Needs review'
    amount = Math.round((lo + rnd() * (hi - lo)) * 100) / 100
    if (cat === 'Income') type = 'income'
  }
  const account = pick(accounts)
  const base = lib.baseFingerprint(date, merchant, amount, account)
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  rows.push({ date, merchant, memo, category, amount, type, account, source: 'qa-seed', fingerprint: n > 1 ? `${base}#${n}` : base })
}
const t0 = Date.now()
let inserted = 0
for (let i = 0; i < rows.length; i += 5000) { const b0 = Date.now(); inserted += lib.insertBatch(rows.slice(i, i + 5000)).inserted; if (process.env.QA_SEED_VERBOSE) console.log(`  batch ${i / 5000}: ${Date.now() - b0} ms`) }
lib.closeDatabase()
console.log(`seeded ${inserted.toLocaleString()} transactions into ${dataDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
fs.rmSync(tmp, { recursive: true, force: true })
