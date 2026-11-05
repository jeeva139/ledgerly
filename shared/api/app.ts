export interface AppInfo {
  version: string
  platform: string
  electron: string
  /** Friendly label, e.g. "%APPDATA%\Ledgerly". */
  dataLocation: string
}

export interface AppApi {
  info(): Promise<AppInfo>
  /** Open the Ledgerly data folder in Windows Explorer. */
  openDataFolder(): Promise<void>
}
export const appMethods = { info: 1, openDataFolder: 1 } satisfies Record<keyof AppApi, 1>
