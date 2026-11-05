/** Error codes that cross the IPC boundary. Messages are always user-readable (no stack traces). */
export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'LOCKED'
  | 'IO'
  | 'DB'
  | 'LIMIT'
  | 'UNSUPPORTED'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'INTERNAL'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export interface IpcFailure {
  ok: false
  error: { code: ErrorCode; message: string }
}
export interface IpcSuccess<T> {
  ok: true
  data: T
}
export type IpcResult<T> = IpcSuccess<T> | IpcFailure

export const SAFE_GENERIC_MESSAGE = 'Something went wrong. Your existing data is safe. Please try again.'
