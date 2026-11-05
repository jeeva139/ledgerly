// Import — IPC handlers. Files are read in the main process only; the renderer never sees a path.
import { z } from 'zod'
import { handle, noArgs } from './register'
import { idSchema } from './schemas'
import { MAPPING_FIELDS } from '../../shared/api/imports'
import { AppError } from '../../shared/errors'
import {
  cancelSession, commitSession, importHistory, openFromBytes, openFromDialog, previewRows, previewSession, undoImport
} from '../imports/service'

const accountType = z.enum(['bank', 'credit-card', 'cash', 'wallet', 'other'])

const optionsSchema = z
  .object({
    account: z.object({ name: z.string().max(60), type: accountType.optional() }).nullable().optional(),
    dateFormat: z.enum(['auto', 'DMY', 'MDY']).optional(),
    signConvention: z.enum(['normal', 'reverse']).optional(),
    mapping: z.record(z.enum(MAPPING_FIELDS), z.number().int().min(0).max(1000).nullable()).optional(),
    headerRow: z.number().int().min(-1).max(1000).nullable().optional(),
    sheet: z.string().max(200).nullable().optional(),
    rulesOverrideImported: z.boolean().optional(),
    addNewCategories: z.boolean().optional()
  })
  .strict()

/** Bytes arrive as a Uint8Array / Buffer (or an ArrayBuffer) through the structured-clone IPC channel. */
const bytesSchema = z
  .custom<Uint8Array | ArrayBuffer>((v) => v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v), 'Please choose a valid file.')
  .transform((v): Uint8Array => {
    if (v instanceof Uint8Array) return v
    if (v instanceof ArrayBuffer) return new Uint8Array(v)
    const view = v as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  })

export function registerImportIpc(): void {
  handle('import.qif', noArgs, () => openFromDialog('qif'))
  handle('import.csv', noArgs, () => openFromDialog('csv'))
  handle('import.excel', noArgs, () => openFromDialog('excel'))

  handle('import.openBytes', z.object({ filename: z.string().min(1).max(260), bytes: bytesSchema }), ({ filename, bytes }) => {
    if (bytes.byteLength === 0) throw new AppError('VALIDATION', 'This file is empty.')
    return openFromBytes(filename, bytes)
  })

  handle('import.preview', z.object({ sessionId: idSchema, options: optionsSchema }), ({ sessionId, options }) => previewSession(sessionId, options))

  handle(
    'import.previewRows',
    z.object({
      sessionId: idSchema,
      filter: z.enum(['all', 'new', 'duplicate', 'needs-review', 'invalid']),
      page: z.number().int().min(1).max(1_000_000),
      pageSize: z.number().int().min(1).max(500)
    }),
    ({ sessionId, filter, page, pageSize }) => previewRows(sessionId, filter, page, pageSize)
  )

  handle('import.commit', z.object({ sessionId: idSchema, options: optionsSchema }), ({ sessionId, options }) => commitSession(sessionId, options))
  handle('import.cancel', z.object({ sessionId: idSchema }), ({ sessionId }) => cancelSession(sessionId))
  handle('import.history', noArgs, () => importHistory())
  handle('import.undo', z.object({ importId: idSchema }), ({ importId }) => undoImport(importId))
}
