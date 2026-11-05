// Central IPC registry. Every channel is registered through `handle`, which:
//  - refuses calls while the application lock is active (unless the channel opts out),
//  - validates input with zod (the renderer is never trusted),
//  - maps every failure to a friendly `{ ok: false, error }` result (no stack traces, no data),
//  - logs failures by code only.
// Handlers live in a Map so tests can call them directly without Electron.
import { z, type ZodTypeAny, type ZodError } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError, SAFE_GENERIC_MESSAGE, type IpcResult, type ErrorCode } from '../../shared/errors'
import { isLocked } from '../security/lockState'
import { logException } from '../logging/logger'

export interface HandlerCtx {
  event?: IpcMainInvokeEvent
}

export type RawHandler = (arg: unknown, ctx: HandlerCtx) => Promise<IpcResult<unknown>>

const handlers = new Map<string, RawHandler>()

/** Schema for methods that take no argument. */
export const noArgs = z.union([z.undefined(), z.null()])

const fail = (code: ErrorCode, message: string): IpcResult<never> => ({ ok: false, error: { code, message } })

function issueMessage(err: ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Some of the information entered is not valid.'
  const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : ''
  const generic = issue.code === 'invalid_type' || issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal'
  if (generic) return field ? `Please check the "${field}" value.` : 'Some of the information entered is not valid.'
  return issue.message
}

export function mapError(channel: string, e: unknown): IpcResult<never> {
  if (e instanceof AppError) return fail(e.code, e.message)
  const err = e as { code?: string; message?: string; name?: string }
  const msg = typeof err?.message === 'string' ? err.message : ''
  if (err?.code === 'ERR_SQLITE_ERROR' || /SQLITE|constraint failed/i.test(msg)) {
    logException(`ipc.${channel}`, e)
    if (/UNIQUE constraint failed: transactions\.fingerprint/i.test(msg)) {
      return fail('DUPLICATE', 'A transaction with the same date, merchant, amount and account already exists.')
    }
    if (/database is locked|busy/i.test(msg)) {
      return fail('DB', 'Ledgerly is busy right now. Please try again in a moment.')
    }
    return fail('DB', 'Ledgerly could not save this change.\n\nYour existing data is safe. Please try again.')
  }
  if (err?.code === 'ENOENT') return fail('IO', 'The file could not be found. It may have been moved or deleted.')
  if (err?.code === 'EACCES' || err?.code === 'EPERM') return fail('IO', 'Ledgerly does not have permission to access that file.')
  if (err?.code === 'ENOSPC') return fail('IO', 'There is not enough free disk space to complete this operation.')
  logException(`ipc.${channel}`, e)
  return fail('INTERNAL', SAFE_GENERIC_MESSAGE)
}

export function handle<S extends ZodTypeAny>(
  channel: string,
  schema: S,
  fn: (arg: z.infer<S>, ctx: HandlerCtx) => unknown | Promise<unknown>,
  opts: { allowWhenLocked?: boolean } = {}
): void {
  if (handlers.has(channel)) throw new Error(`Duplicate IPC handler: ${channel}`)
  handlers.set(channel, async (raw, ctx) => {
    if (isLocked() && !opts.allowWhenLocked) return fail('LOCKED', 'Ledgerly is locked. Enter your PIN to continue.')
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return fail('VALIDATION', issueMessage(parsed.error))
    try {
      const data = await fn(parsed.data, ctx)
      return { ok: true, data: data === undefined ? null : data }
    } catch (e) {
      return mapError(channel, e)
    }
  })
}

export function registeredChannels(): string[] {
  return [...handlers.keys()]
}

export function getHandlers(): ReadonlyMap<string, RawHandler> {
  return handlers
}

/** Invoke a registered handler directly (tests and internal callers). */
export async function invokeChannel<T = unknown>(channel: string, arg?: unknown, ctx: HandlerCtx = {}): Promise<IpcResult<T>> {
  const h = handlers.get(channel)
  if (!h) return fail('NOT_FOUND', `Unknown channel ${channel}`) as IpcResult<T>
  return (await h(arg, ctx)) as IpcResult<T>
}

/** Like invokeChannel but returns the data or throws the AppError (handy in tests). */
export async function callChannel<T = unknown>(channel: string, arg?: unknown): Promise<T> {
  const res = await invokeChannel<T>(channel, arg)
  if (!res.ok) throw new AppError(res.error.code, res.error.message)
  return res.data
}

export function clearHandlersForTests(): void {
  handlers.clear()
}
