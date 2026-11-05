// Offline enforcement. Ledgerly never needs the network, so the renderer session cancels every
// request that is not a local resource, denies every permission prompt, and Chromium's own
// background networking is switched off in main.ts.
import type { Session } from 'electron'
import { log } from '../logging/logger'

const LOCAL_PREFIXES = ['file://', 'data:', 'blob:', 'devtools://', 'chrome-extension://']

export function installNetworkGuard(ses: Session, opts: { devServerOrigin?: string } = {}): void {
  let blocked = 0
  const dev = opts.devServerOrigin?.replace(/\/$/, '')
  const devWs = dev?.replace(/^http/, 'ws')

  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    if (LOCAL_PREFIXES.some((p) => url.startsWith(p))) return callback({})
    if (dev && (url.startsWith(dev) || (devWs && url.startsWith(devWs)))) return callback({})
    blocked++
    if (blocked <= 5 || blocked % 100 === 0) log.warn('network.blocked', { count: blocked })
    callback({ cancel: true })
  })

  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
}
