// Privacy-preserving logger. Log lines contain only a timestamp, a level, a short event code and
// whitelisted scalar metadata (counts, flags, short identifiers). Never transaction text, amounts,
// account numbers, document contents, secrets or error payloads.
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../database/paths'

type Level = 'info' | 'warn' | 'error'
type Meta = Record<string, number | boolean | string | undefined>

const MAX_BYTES = 1_000_000
const SAFE_STRING = /^[A-Za-z0-9_.:\-/ ]{0,60}$/

function safeMeta(meta?: Meta): string {
  if (!meta) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue
    if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`)
    else if (SAFE_STRING.test(v)) parts.push(`${k}=${v}`)
    else parts.push(`${k}=[redacted]`)
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}

function write(level: Level, event: string, meta?: Meta): void {
  try {
    const dir = paths.logs()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'ledgerly.log')
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'ledgerly.1.log'))
    } catch {
      /* no log file yet */
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${event}${safeMeta(meta)}\n`)
  } catch {
    /* logging must never break the app */
  }
}

export const log = {
  info: (event: string, meta?: Meta) => write('info', event, meta),
  warn: (event: string, meta?: Meta) => write('warn', event, meta),
  error: (event: string, meta?: Meta) => write('error', event, meta)
}

/** Log an exception by class and code only — the message may contain user data, so it is dropped. */
export function logException(context: string, err: unknown): void {
  const e = err as { name?: string; code?: string } | undefined
  write('error', context, { error: e?.name ?? 'Error', code: typeof e?.code === 'string' ? e.code : undefined })
}
