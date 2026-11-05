// Worker-thread entry: parses a statement file off the main thread so the app stays responsive.
// Bundled by scripts/build-main.mjs into dist-electron/import-worker.js (xlsx + papaparse inlined).
import { parentPort } from 'node:worker_threads'
import { parseBytes } from './engine'
import { AppError } from '../../shared/errors'
import type { ImportFormat } from '../../shared/api/imports'

interface Request {
  id: number
  format: ImportFormat
  bytes: Uint8Array
  sheet?: string | null
}

parentPort?.on('message', (msg: Request) => {
  try {
    const result = parseBytes(msg.format, msg.bytes, { sheet: msg.sheet })
    parentPort?.postMessage({ id: msg.id, ok: true, result })
  } catch (e) {
    const err = e instanceof AppError ? e : null
    parentPort?.postMessage({
      id: msg.id,
      ok: false,
      code: err?.code ?? 'INTERNAL',
      message: err?.message ?? 'Ledgerly could not read this file.'
    })
  }
})
