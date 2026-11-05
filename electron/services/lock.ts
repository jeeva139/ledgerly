// Optional application lock (PIN / passphrase). It gates access to the app UI and IPC;
// it does NOT encrypt the database or documents on disk — the UI says so plainly.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getSetting, setSetting, K } from './settings'
import { isLocked, setLocked } from '../security/lockState'
import { AppError } from '../../shared/errors'

interface LockConfig {
  enabled: boolean
  salt: string
  hash: string
  idleMinutes: number
}

const DEFAULT: LockConfig = { enabled: false, salt: '', hash: '', idleMinutes: 0 }

const getConfig = (): LockConfig => ({ ...DEFAULT, ...getSetting<Partial<LockConfig>>(K.lock, {}) })

const derive = (pin: string, salt: Buffer) => scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 })

function validatePin(pin: string): void {
  if (typeof pin !== 'string' || pin.length < 4) throw new AppError('VALIDATION', 'Use at least 4 characters for the application lock.')
  if (pin.length > 64) throw new AppError('VALIDATION', 'The application lock can be at most 64 characters long.')
}

function verify(pin: string): boolean {
  const cfg = getConfig()
  if (!cfg.enabled || !cfg.hash) return false
  const actual = derive(pin, Buffer.from(cfg.salt, 'hex'))
  const expected = Buffer.from(cfg.hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

let failures = 0
let lockedOutUntil = 0

export interface LockStatus {
  enabled: boolean
  locked: boolean
  idleMinutes: number
}

export function lockStatus(): LockStatus {
  const cfg = getConfig()
  return { enabled: cfg.enabled, locked: cfg.enabled && isLocked(), idleMinutes: cfg.idleMinutes }
}

/** Called once at start-up after the database is open. */
export function initLockOnStartup(): void {
  setLocked(getConfig().enabled)
}

export function unlock(pin: string): LockStatus {
  const now = Date.now()
  if (now < lockedOutUntil) {
    const secs = Math.ceil((lockedOutUntil - now) / 1000)
    throw new AppError('LOCKED', `Too many incorrect attempts. Try again in ${secs} seconds.`)
  }
  if (!verify(pin)) {
    failures++
    if (failures >= 5) {
      lockedOutUntil = Date.now() + Math.min(300_000, 15_000 * 2 ** (failures - 5))
    }
    throw new AppError('VALIDATION', 'That is not the correct PIN.')
  }
  failures = 0
  lockedOutUntil = 0
  setLocked(false)
  return lockStatus()
}

export function lockNow(): LockStatus {
  if (!getConfig().enabled) throw new AppError('VALIDATION', 'Set an application lock in Settings first.')
  setLocked(true)
  return lockStatus()
}

/** Enable the lock, or change it (`currentPin` required when one is already set). */
export function setPin(pin: string, currentPin?: string): LockStatus {
  validatePin(pin)
  const cfg = getConfig()
  if (cfg.enabled && !verify(currentPin ?? '')) throw new AppError('VALIDATION', 'The current PIN is not correct.')
  const salt = randomBytes(16)
  setSetting(K.lock, { enabled: true, salt: salt.toString('hex'), hash: derive(pin, salt).toString('hex'), idleMinutes: cfg.idleMinutes })
  return lockStatus()
}

export function removePin(pin: string): LockStatus {
  if (!verify(pin)) throw new AppError('VALIDATION', 'That is not the correct PIN.')
  setSetting(K.lock, DEFAULT)
  setLocked(false)
  return lockStatus()
}

export function setIdleMinutes(minutes: number): LockStatus {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new AppError('VALIDATION', 'Choose between 0 and 240 minutes.')
  setSetting(K.lock, { ...getConfig(), idleMinutes: minutes })
  return lockStatus()
}
