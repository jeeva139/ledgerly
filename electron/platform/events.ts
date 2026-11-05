// Main → renderer notifications. In tests (no windows) events are captured by a sink instead.
import type { EventChannel } from '../../shared/api/events'

type Sink = (channel: EventChannel, payload: unknown) => void
let testSink: Sink | null = null

export function setEventSink(sink: Sink | null): void {
  testSink = sink
}

function electron(): typeof import('electron') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const e = require('electron') as typeof import('electron')
    return e && typeof e === 'object' && e.BrowserWindow ? e : null
  } catch {
    return null
  }
}

export function emitEvent(channel: EventChannel, payload?: unknown): void {
  if (testSink) {
    testSink(channel, payload)
    return
  }
  const e = electron()
  if (!e) return
  for (const win of e.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Reload every window (used after a restore or a full data wipe so the UI starts clean). */
export function reloadWindows(): void {
  const e = electron()
  if (!e) return
  for (const win of e.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.reloadIgnoringCache()
  }
}
