// Preload bridge. The renderer gets a fixed, typed set of methods (window.ledgerly.<area>.<method>)
// that each forward to one validated IPC channel — no Node APIs, no raw ipcRenderer, no file system.
import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, EVENT_CHANNELS, type EventChannel } from '../shared/api'

type Fn = (arg?: unknown) => Promise<unknown>
const api: Record<string, Record<string, Fn>> = {}
for (const [ns, methods] of Object.entries(API_METHODS)) {
  api[ns] = {}
  for (const m of methods) {
    const channel = `${ns}.${m}`
    api[ns][m] = (arg?: unknown) => ipcRenderer.invoke(channel, arg)
  }
}

const events = {
  /** Subscribe to a main-process event; returns an unsubscribe function. */
  on(channel: EventChannel, callback: (payload: unknown) => void): () => void {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error('Unknown event channel')
    const listener = (_e: unknown, payload: unknown) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('ledgerly', { ...api, events })
