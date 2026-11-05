// Offline-architecture audit (spec §108). Scans first-party source and the built bundles for anything
// that could touch the network, and classifies every URL found.
//   node scripts/audit-network.mjs            → prints a report, exits 1 if an unjustified hit exists
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE_DIRS = ['electron', 'src', 'shared', 'scripts']
const BUNDLES = ['dist-electron', 'dist/assets']

// Network-capable APIs / services / vendors that must not appear in first-party source.
const API_PATTERNS = [
  ['fetch(', /\bfetch\s*\(/],
  ['axios', /\baxios\b/i],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /\bnew\s+WebSocket\b|\bWebSocket\s*\(/],
  ['node http/https client', /from\s+['"](?:node:)?https?['"]|require\(\s*['"](?:node:)?https?['"]\s*\)/],
  ['net/tls/dgram', /from\s+['"](?:node:)?(?:net|tls|dgram|dns)['"]|require\(\s*['"](?:node:)?(?:net|tls|dgram|dns)['"]\s*\)/],
  ['electron net/autoUpdater', /\b(?:net\.request|net\.fetch|autoUpdater|electron-updater)\b/],
  ['sendBeacon', /sendBeacon/],
  ['EventSource', /new\s+EventSource/],
  ['Google APIs', /googleapis|google-analytics|gtag\(|firebase/i],
  ['OpenAI / AI APIs', /openai\.com|api\.anthropic|api\.openai|@anthropic-ai|chatgpt\.com/i],
  ['Cloudflare / Drive', /cloudflare|workers\.dev|drive\.google|r2\.cloudflarestorage/i],
  ['telemetry / analytics SDKs', /sentry|mixpanel|segment\.io|amplitude|posthog|datadog|bugsnag|telemetry\(|analytics\(/i]
]

// URLs that are inert identifiers or comments, never requested. Anything else is reported.
const URL_ALLOW = [
  [/^http:\/\/www\.w3\.org\//, 'XML/SVG/XHTML namespace identifier (not a request)'],
  [/^http:\/\/schemas\.(openxmlformats|microsoft)\.org\//, 'OOXML namespace identifier (xlsx parsing)'],
  [/^http:\/\/purl\.org\//, 'Dublin Core namespace identifier (xlsx parsing)'],
  [/^http:\/\/schemas\.openxmlformats\.org\//, 'OOXML namespace identifier'],
  [/^https:\/\/react\.dev\//, 'React error-message documentation link (string only)'],
  [/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/, 'loopback dev server / local debugging only'],
  [/^https:\/\/(?:github\.com|www\.npmjs\.com|developer\.mozilla\.org|nodejs\.org|tools\.ietf\.org|datatracker\.ietf\.org|en\.wikipedia\.org|docs\.sheetjs\.com|sheetjs\.com|cdn\.sheetjs\.com|stackoverflow\.com|w3c\.github\.io|www\.w3\.org|reactjs\.org|bugs\.chromium\.org|crbug\.com|json-schema\.org|zod\.dev|recharts\.org|d3js\.org|www\.ecma-international\.org|spec\.whatwg\.org|html\.spec\.whatwg\.org)\b/, 'documentation / specification link inside a comment or string (never requested)']
]

const textExt = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.yml'])
function* walk(dir) {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(full, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.qa-data') continue
      yield* walk(path.relative(root, p))
    } else if (textExt.has(path.extname(e.name))) yield p
  }
}

const rel = (p) => path.relative(root, p).replace(/\\/g, '/')
const problems = []
const notes = []

// 1) First-party source: network APIs must be absent; URLs must be inert.
let scanned = 0
for (const dir of SOURCE_DIRS) {
  for (const file of walk(dir)) {
    if (rel(file) === 'scripts/audit-network.mjs' || rel(file).startsWith('scripts/qa/') || rel(file) === 'scripts/setup-electron.mjs') continue
    scanned++
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const [name, re] of API_PATTERNS) {
        if (re.test(line)) problems.push(`${rel(file)}:${i + 1}  network API/vendor reference: ${name}\n      ${line.trim().slice(0, 140)}`)
      }
      for (const m of line.matchAll(/https?:\/\/[^\s'"`)<>\]]+/g)) {
        const url = m[0]
        const ok = URL_ALLOW.find(([re]) => re.test(url))
        if (!ok) problems.push(`${rel(file)}:${i + 1}  unexpected URL ${url}`)
      }
    })
  }
}
notes.push(`Scanned ${scanned} first-party source files.`)

// 2) Built bundles: third-party code is bundled in, so only summarise external hosts and flag real API use.
for (const dir of BUNDLES) {
  for (const file of walk(dir)) {
    if (!file.endsWith('.js')) continue
    const text = fs.readFileSync(file, 'utf8')
    const hosts = new Map()
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)[^\s'"`)<>\]]*/gi)) hosts.set(m[1].toLowerCase(), (hosts.get(m[1].toLowerCase()) ?? 0) + 1)
    const hostList = [...hosts.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}×${n}`)
    notes.push(`${rel(file)} (${(text.length / 1024).toFixed(0)} KB): external hosts referenced as strings → ${hostList.length ? hostList.join(', ') : 'none'}`)
    const dangerous = [
      ['openai', /api\.openai\.com/],
      ['anthropic', /api\.anthropic\.com/],
      ['google analytics', /google-analytics\.com|googletagmanager\.com/],
      ['cloudflare workers', /workers\.dev/],
      ['sentry', /sentry\.io/],
      ['EventSource', /new EventSource/]
    ]
    for (const [name, re] of dangerous) if (re.test(text)) problems.push(`${rel(file)}: bundle contains ${name}`)
  }
}

console.log('Ledgerly offline-architecture audit\n')
for (const n of notes) console.log('  ' + n)
if (problems.length) {
  console.log(`\n${problems.length} item(s) need justification or removal:\n`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('\n  ✓ No fetch/axios/XMLHttpRequest/WebSocket/http(s) client, vendor SDK, telemetry or cloud reference in first-party code.')
console.log('  ✓ Every URL string found is an inert namespace/documentation identifier (allow-list above).')
console.log('  Runtime enforcement: the renderer session cancels every non-local request (electron/security/netGuard.ts),')
console.log('  the packaged CSP sets connect-src \'self\', permissions are denied, and Chromium background networking is disabled.')
