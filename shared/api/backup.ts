// Backup / Restore and the full data wipe — API contract.

export interface BackupCounts {
  transactions: number
  documents: number
  rules: number
  tags: number
}

/** A backup file in the Ledgerly backups folder (no raw paths are ever exposed). */
export interface BackupFileInfo {
  name: string
  size: number
  createdAt: string
}

/** What a backup package contains, as read from its validated manifest. */
export interface BackupSummary {
  appVersion: string
  schemaVersion: number
  createdAt: string
  counts: BackupCounts
  documentFiles: number
  /** Size of the package on disk. */
  size: number
}

export interface BackupCreateResult {
  /** False when the user closed the save dialog. */
  saved: boolean
  name: string
  size: number
  summary: BackupSummary | null
}

export interface BackupInspectResult {
  /** Pass to `restore`. Valid for a short time only. */
  token: string
  fileName: string
  summary: BackupSummary
}

export interface RestoreResult {
  restored: boolean
  /** Name of the automatic safety backup of the previous data, when one was made. */
  safetyBackupName: string | null
  summary: BackupSummary
}

/**
 * Local backup packages (`.ledgerlybackup`): manifest + database snapshot + document vault.
 * Restore validates everything in a staging area first and never partially replaces current data.
 */
export interface BackupApi {
  /** `ask` opens a native save dialog; `backups-folder` writes straight into the Ledgerly backups folder. */
  create(input: { destination: 'ask' | 'backups-folder' }): Promise<BackupCreateResult>
  list(): Promise<BackupFileInfo[]>
  /**
   * Validate a backup package. Without `name` a native open dialog is shown (resolves null if cancelled);
   * with `name` a file from the Ledgerly backups folder is inspected. Throws a friendly error when invalid.
   */
  inspect(input?: { name?: string }): Promise<BackupInspectResult | null>
  /** Replace the current data with an inspected backup. `safetyBackup` (default true) backs up the current data first. */
  restore(input: { token: string; safetyBackup?: boolean }): Promise<RestoreResult>
}

export const backupMethods = { create: 1, list: 1, inspect: 1, restore: 1 } satisfies Record<keyof BackupApi, 1>

export interface DataApi {
  /**
   * Permanently delete every Ledgerly record, document and setting and return to a fresh install.
   * `confirmation` must be exactly "DELETE".
   */
  eraseAll(input: { confirmation: string; safetyBackup?: boolean }): Promise<{ safetyBackupName: string | null }>
}

export const dataMethods = { eraseAll: 1 } satisfies Record<keyof DataApi, 1>
