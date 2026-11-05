// QA driver: launches the real Ledgerly app against a throwaway data folder and controls it over the
// Chrome DevTools Protocol (local debugging port). Run scripts that import this with:
//   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe scripts\qa\<script>.mjs
// (Electron's Node 24 provides global fetch / WebSocket.)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function makeTempDataDir(label = 'qa') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ledgerly-${label}-`))
}

export async function launch({ dataDir = makeTempDataDir(), port = 9333, width = 1440, height = 900, exe = electronExe, args = ['.'], extraEnv = {} } = {}) {
  const env = { ...process.env, LEDGERLY_DATA_DIR: dataDir, ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const child = spawn(exe, [...args, `--remote-debugging-port=${port}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d.toString()))
  child.stdout.on('data', () => {})
  let exited = false
  child.on('exit', () => (exited = true))

  let target
  for (let i = 0; i < 120 && !target; i++) {
    if (exited) throw new Error('Ledgerly exited early:\n' + stderr)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page' && /index\.html|127\.0\.0\.1:5173/.test(t.url))
    } catch {
      /* not up yet */
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('Ledgerly window did not appear:\n' + stderr)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let nextId = 1
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('Ledgerly window closed'))
    pending.clear()
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')

  const api = {
    dataDir,
    consoleErrors,
    send,
    async setSize(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await sleep(250)
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      return file
    },
    async waitFor(expression, timeout = 10000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        try {
          if (await api.eval(expression)) return true
        } catch {
          /* page busy */
        }
        await sleep(150)
      }
      throw new Error('Timed out waiting for: ' + expression)
    },
    /** Click the first element matching the selector whose text includes `text` (optional). */
    async click(selector, text) {
      const ok = await api.eval(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        const el = ${text === undefined ? 'els[0]' : `els.find(e => e.textContent.includes(${JSON.stringify(text)}) || e.getAttribute('aria-label') === ${JSON.stringify(text)})`}
        if (!el) return false
        el.click(); return true })()`)
      if (!ok) throw new Error(`click: nothing matches ${selector} ${text ?? ''}`)
      await sleep(150)
    },
    /** Set a React-controlled input/select/textarea value. */
    async fill(selector, value) {
      const ok = await api.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
      if (!ok) throw new Error(`fill: nothing matches ${selector}`)
      await sleep(100)
    },
    sleep,
    async close() {
      try {
        await Promise.race([send('Browser.close'), sleep(2500)])
      } catch {
        /* closing */
      }
      await sleep(400)
      if (!exited) child.kill()
    },
    get stderr() {
      return stderr
    }
  }
  return api
}
