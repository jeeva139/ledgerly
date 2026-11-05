export interface LockStatus {
  enabled: boolean
  locked: boolean
  idleMinutes: number
}

/** Optional application lock. Gates the UI and IPC; it does not encrypt data on disk. */
export interface LockApi {
  status(): Promise<LockStatus>
  unlock(input: { pin: string }): Promise<LockStatus>
  lockNow(): Promise<LockStatus>
  /** Turn the lock on or change it. `currentPin` is required when a lock already exists. */
  setPin(input: { pin: string; currentPin?: string }): Promise<LockStatus>
  removePin(input: { pin: string }): Promise<LockStatus>
  setIdleMinutes(input: { minutes: number }): Promise<LockStatus>
}
export const lockMethods = {
  status: 1, unlock: 1, lockNow: 1, setPin: 1, removePin: 1, setIdleMinutes: 1
} satisfies Record<keyof LockApi, 1>
