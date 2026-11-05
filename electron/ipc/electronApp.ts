// Tiny indirection over `electron.app` so IPC modules can be imported in plain Node (tests).
let versionOverride: string | null = null

export const app = {
  version(): string {
    if (versionOverride) return versionOverride
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron')
      if (electron && typeof electron === 'object' && electron.app) return electron.app.getVersion()
    } catch {
      /* not running inside Electron */
    }
    return process.env.npm_package_version ?? '1.0.0'
  }
}

export function setAppVersionForTests(v: string | null): void {
  versionOverride = v
}
