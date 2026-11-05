import type { DocumentExtraction, DocumentKind, DocumentRecord, DocumentStatus } from '../types'

export interface DocumentListInput {
  search?: string
  kind?: DocumentKind | 'all'
  status?: DocumentStatus | 'all'
  page?: number
  pageSize?: number
}

export interface UploadResult {
  added: DocumentRecord[]
  /** Files that were refused (too large, unsupported type, empty …) with a readable reason. */
  rejected: { filename: string; reason: string }[]
  /** True when the user closed the file dialog without choosing anything. */
  cancelled: boolean
}

/**
 * Local document vault. Originals are stored on this computer only (max 20 MB per file).
 * Owned by the Documents feature area; `uploadBytes`, `open` and `get` are also used by the
 * Transactions area (receipts) so their shapes must stay stable.
 */
export interface DocumentsApi {
  list(input?: DocumentListInput): Promise<{ rows: DocumentRecord[]; total: number }>
  /** Native multi-select file dialog → store every chosen file. */
  upload(input?: { kind?: DocumentKind }): Promise<UploadResult>
  /**
   * Store bytes handed over by the renderer (drag & drop, receipt attach). Enforces the 20 MB limit.
   * `extract` (default false) also runs local text extraction and may set the status to "review".
   */
  uploadBytes(input: { filename: string; bytes: Uint8Array; kind?: DocumentKind; extract?: boolean }): Promise<DocumentRecord>
  get(input: { id: string }): Promise<DocumentRecord>
  update(input: { id: string; note?: string; kind?: DocumentKind; status?: DocumentStatus }): Promise<DocumentRecord>
  delete(input: { id: string }): Promise<void>
  /** Open with the default Windows application. */
  open(input: { id: string }): Promise<void>
  /** "Save a copy as…" dialog. Resolves false when cancelled. */
  saveCopy(input: { id: string }): Promise<boolean>
  /** (Re)run local extraction (merchant/date/amount) — never invents values. */
  extract(input: { id: string }): Promise<DocumentExtraction>
}

export const documentsMethods = {
  list: 1, upload: 1, uploadBytes: 1, get: 1, update: 1, delete: 1, open: 1, saveCopy: 1, extract: 1
} satisfies Record<keyof DocumentsApi, 1>
