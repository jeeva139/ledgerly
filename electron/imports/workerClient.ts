// Main-process side of the parser worker. Falls back to parsing inline when the worker bundle is not
// available (tests, development before the first build) or cannot be started.
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { AppError, type ErrorCode } from '../../shared/errors'
import type { ImportFormat } from '../../shared/api/imports'
import { parseBytes } from './engine'
import type { ParsedFile } from './types'

interface Pending {
  resolve: (v: ParsedFile) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let disabled = false

function workerFile(): string | null {
  const dir = typeof __dirname !== 'undefined' ? __dirname : ''
  if (!dir) return null
  const candidate = path.join(dir, 'import-worker.js')
  // Inside a packaged app the bundle sits in app.asar.unpacked (see asarUnpack in electron-builder.yml).
  const unpacked = candidate.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  for (const f of [unpacked, candidate]) if (fs.existsSync(f)) return f
  return null
}

function ensureWorker(): Worker | null {
  if (disabled) return null
  if (worker) return worker
  const file = workerFile()
  if (!file) return null
  try {
    const w = new Worker(file)
    w.unref()
    w.on('message', (m: { id: number; ok: boolean; result?: ParsedFile; code?: ErrorCode; message?: string }) => {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result as ParsedFile)
      else p.reject(new AppError(m.code ?? 'INTERNAL', m.message ?? 'Ledgerly could not read this file.'))
    })
    const drop = () => {
      for (const p of pending.values()) p.reject(new AppError('INTERNAL', 'Ledgerly could not read this file. Please try again.'))
      pending.clear()
      worker = null
    }
    w.on('error', drop)
    w.on('exit', drop)
    worker = w
    return w
  } catch {
    disabled = true
    return null
  }
}

/** Parse a statement file in the worker thread (or inline when no worker is available). */
export function parseFile(format: ImportFormat, bytes: Uint8Array, opts: { sheet?: string | null } = {}): Promise<ParsedFile> {
  const w = ensureWorker()
  if (!w) {
    try {
      return Promise.resolve(parseBytes(format, bytes, opts))
    } catch (e) {
      return Promise.reject(e)
    }
  }
  return new Promise<ParsedFile>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    w.postMessage({ id, format, bytes, sheet: opts.sheet ?? null })
  })
}

export function shutdownImportWorker(): void {
  worker?.terminate().catch(() => undefined)
  worker = null
}
