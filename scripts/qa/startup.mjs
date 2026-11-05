// Where does launch time go?  spawn → debug port → page loaded → React mounted → first data.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const exe = process.argv[2] ?? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const args = process.argv[2] ? [] : ['.']
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-start-'))
const env = { ...process.env, LEDGERLY_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE
const t0 = Date.now(); const lap = (l) => console.log(String(Date.now() - t0).padStart(6) + ' ms  ' + l)
const child = spawn(exe, [...args, '--remote-debugging-port=9370', ...(process.env.QA_EXTRA ? process.env.QA_EXTRA.split(' ') : [])], { cwd: root, env, stdio: 'ignore' })
let target
while (!target) { try { const l = await (await fetch('http://127.0.0.1:9370/json')).json(); target = l.find((t) => t.type === 'page') } catch {} await new Promise((r) => setTimeout(r, 100)) }
lap('debug port up, page target exists')
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 1; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m.result) }
const send = (method, params = {}) => new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value
while (!(await ev("document.readyState === 'complete'"))) await new Promise((r) => setTimeout(r, 50))
lap('document complete')
while (!(await ev("!!document.querySelector('.app')"))) await new Promise((r) => setTimeout(r, 50))
lap('React app rendered')
console.log('resources:', await ev('JSON.stringify(performance.getEntriesByType("resource").map(r => ({ n: r.name.split("/").pop(), start: Math.round(r.startTime), dur: Math.round(r.duration) })))')); console.log('nav:', await ev('JSON.stringify((() => { const n = performance.getEntriesByType("navigation")[0]; return { fetchStart: Math.round(n.fetchStart), responseEnd: Math.round(n.responseEnd), domInteractive: Math.round(n.domInteractive), dcl: Math.round(n.domContentLoadedEventEnd) } })())')); console.log('page-internal: ', await ev('JSON.stringify({ domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart), load: Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart) })'))
await send('Browser.close'); setTimeout(() => process.exit(0), 500)
