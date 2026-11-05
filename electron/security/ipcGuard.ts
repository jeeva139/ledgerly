import type { IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Only the application's own top-level page may call IPC handlers.
 * Packaged: the bundled dist/index.html. Development: the local Vite dev server.
 */
export function createSenderValidator(opts: { devServerUrl?: string; appDir: string }): (event: IpcMainInvokeEvent) => boolean {
  const appIndex = pathToFileURL(path.join(opts.appDir, '..', 'dist', 'index.html')).href
  const dev = opts.devServerUrl?.replace(/\/$/, '')
  return (event) => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame) return false
    const url = frame.url
    if (dev) return url.startsWith(dev)
    return url === appIndex || url.startsWith(`${appIndex}#`) || url.startsWith(`${appIndex}?`)
  }
}
