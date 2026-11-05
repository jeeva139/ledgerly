// Renderer-side API. `window.ledgerly` (preload bridge) returns result envelopes; this wrapper
// unwraps them so calls read naturally:  const rows = await api.transactions.list(...)
// Failures throw ApiError whose message is already user-friendly.
import type { LedgerlyApi, RawApi, EventChannel } from '@shared/api'
import type { ErrorCode } from '@shared/errors'

export class ApiError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

type Bridge = RawApi & { events: { on(channel: EventChannel, cb: (payload: unknown) => void): () => void } }

const bridge = (): Bridge | undefined => (typeof window !== 'undefined' ? (window as unknown as { ledgerly?: Bridge }).ledgerly : undefined)

export const bridgeAvailable = (): boolean => !!bridge()

export const api: LedgerlyApi = new Proxy({} as LedgerlyApi, {
  get(_t, ns: string) {
    return new Proxy(
      {},
      {
        get(_n, method: string) {
          return async (arg?: unknown) => {
            const b = bridge() as unknown as Record<string, Record<string, (a?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: { code: ErrorCode; message: string } }>>> | undefined
            if (!b) throw new ApiError('INTERNAL', 'Ledgerly must be opened as the desktop application.')
            const res = await b[ns][method](arg)
            if (res.ok) return res.data
            throw new ApiError(res.error!.code, res.error!.message)
          }
        }
      }
    )
  }
})

export const events = {
  on(channel: EventChannel, cb: (payload: unknown) => void): () => void {
    const b = bridge()
    return b ? b.events.on(channel, cb) : () => undefined
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Something went wrong. Your existing data is safe. Please try again.'
}
