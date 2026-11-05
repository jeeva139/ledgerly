// Documents — IPC handlers (`documents.*`).
import { z } from 'zod'
import { handle } from './register'
import { idSchema } from './schemas'
import * as docs from '../services/documents'
import { deleteDocument, getDocument } from '../documents/vault'
import { AppError } from '../../shared/errors'

const kind = z.enum(['receipt', 'invoice', 'statement', 'spreadsheet', 'other'])
const status = z.enum(['stored', 'review', 'queued'])

export function registerDocumentsIpc(): void {
  handle(
    'documents.list',
    z
      .object({
        search: z.string().max(200).optional(),
        kind: z.union([kind, z.literal('all')]).optional(),
        status: z.union([status, z.literal('all')]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(500).optional()
      })
      .optional(),
    (input) => docs.listDocuments(input ?? {})
  )
  handle('documents.upload', z.object({ kind: kind.optional() }).optional(), (input) => docs.uploadViaDialog(input?.kind))
  handle(
    'documents.uploadBytes',
    z.object({
      filename: z.string().min(1, 'The file needs a name.').max(260),
      bytes: z.instanceof(Uint8Array, { message: 'The file data could not be read.' }),
      kind: kind.optional(),
      extract: z.boolean().optional()
    }),
    ({ filename, bytes, kind: k, extract }) => docs.storeAndProcess({ filename, bytes, kind: k, extract: extract ?? false })
  )
  handle('documents.get', z.object({ id: idSchema }), ({ id }) => {
    const doc = getDocument(id)
    if (!doc) throw new AppError('NOT_FOUND', 'That document no longer exists.')
    return doc
  })
  handle(
    'documents.update',
    z.object({ id: idSchema, note: z.string().max(2000).optional(), kind: kind.optional(), status: status.optional() }),
    ({ id, ...patch }) => docs.updateDocument(id, patch)
  )
  handle('documents.delete', z.object({ id: idSchema }), ({ id }) => deleteDocument(id))
  handle('documents.open', z.object({ id: idSchema }), ({ id }) => docs.openDocument(id))
  handle('documents.saveCopy', z.object({ id: idSchema }), ({ id }) => docs.saveDocumentCopy(id))
  handle('documents.extract', z.object({ id: idSchema }), ({ id }) => docs.runExtraction(id))
}
