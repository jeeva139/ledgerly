import { useState } from 'react'
import { FilePlus2, Import, RefreshCw, ScanText } from 'lucide-react'
import { DOCUMENT_MAX_BYTES, type DocumentKind, type DocumentRecord, type DocumentStatus } from '@shared/types'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Alert } from '@/components/feedback'
import { Field, Select, Textarea } from '@/components/form'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'
import { formatBytes } from '@/utils/misc'
import { KIND_LABELS, STATUS_LABELS, isStatementName } from './labels'

interface Props {
  doc: DocumentRecord
  onClose: () => void
  onChanged: () => void
}

export function DocumentDetailModal({ doc: initial, onClose, onChanged }: Props) {
  const app = useApp()
  const toast = useToast()
  const [doc, setDoc] = useState(initial)
  const [note, setNote] = useState(initial.note)
  const [kind, setKind] = useState<DocumentKind>(initial.kind)
  const [status, setStatus] = useState<DocumentStatus>(initial.status)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const dirty = note !== doc.note || kind !== doc.kind || status !== doc.status
  const ex = doc.extracted
  const hasValues = !!ex && (ex.merchant !== null || ex.date !== null || ex.amount !== null)
  const statement = isStatementName(doc.filename)

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.documents.update({ id: doc.id, note, kind, status })
      setDoc(updated)
      setNote(updated.note)
      setKind(updated.kind)
      setStatus(updated.status)
      onChanged()
      toast.success('Document details saved.')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const rerun = async () => {
    setExtracting(true)
    try {
      await api.documents.extract({ id: doc.id })
      const fresh = await api.documents.get({ id: doc.id })
      setDoc(fresh)
      setStatus(fresh.status)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExtracting(false)
    }
  }

  const createTransaction = () => {
    if (!ex) return
    const prefill: Record<string, unknown> = { documentId: doc.id }
    if (ex.merchant) prefill.merchant = ex.merchant
    if (ex.date) prefill.date = ex.date
    if (ex.amount !== null) prefill.amount = ex.amount
    if (ex.type) prefill.type = ex.type
    if (ex.category) prefill.category = ex.category
    onClose()
    app.openAddEntry(prefill)
  }

  return (
    <Modal
      title={doc.filename}
      subtitle={`${KIND_LABELS[doc.kind]} · ${formatBytes(doc.size)} · ${doc.source === 'import' ? 'Created by an import' : 'Uploaded'} ${app.fmt.dateTime(doc.createdAt)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack lg">
        {doc.status === 'review' && (
          <Alert kind="warning">
            <strong>Review required.</strong> Ledgerly read some values from this document locally. Check them before using them.
          </Alert>
        )}

        <section className="stack">
          <div className="row between">
            <h3>What Ledgerly could read</h3>
            {!statement && (
              <Button size="sm" icon={doc.extracted ? RefreshCw : ScanText} onClick={() => void rerun()} loading={extracting}>
                {doc.extracted ? 'Read again' : 'Read this document'}
              </Button>
            )}
          </div>
          {ex ? (
            <>
              {hasValues ? (
                <dl className="extract-grid" aria-label="Extracted values">
                  {(
                    [
                      ['Merchant', ex.merchant],
                      ['Date', ex.date ? app.fmt.date(ex.date) : null],
                      ['Amount', ex.amount !== null ? app.fmt.money(ex.amount) : null],
                      ['Type', ex.type ? (ex.type === 'expense' ? 'Expense' : 'Income') : null],
                      ['Category', ex.category]
                    ] as [string, string | null][]
                  ).map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt>{label}</dt>
                      <dd className={value ? '' : 'empty-value'}>{value ?? 'Not found'}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <div className="small muted" style={{ whiteSpace: 'pre-line' }}>
                {ex.message}
              </div>
              {hasValues && (
                <div>
                  <Button icon={FilePlus2} onClick={createTransaction}>
                    Create transaction from this document
                  </Button>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    The form opens with only the values above filled in. Nothing is saved until you confirm.
                  </div>
                </div>
              )}
            </>
          ) : statement ? (
            <div className="muted">This looks like a statement. Use Import to add its transactions.</div>
          ) : (
            <div className="muted">Ledgerly has not read this document yet.</div>
          )}
          {statement && (
            <div>
              <Button
                icon={Import}
                onClick={() => {
                  onClose()
                  app.navigate('import')
                }}
              >
                Import this statement
              </Button>
            </div>
          )}
        </section>

        <section className="form-grid">
          <Field label="Type of document">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {(Object.keys(KIND_LABELS) as DocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status" hint="“Review required” stays until you mark the document as reviewed.">
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus)}>
                {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Note" className="full" hint={`${note.length.toLocaleString()} / 2,000`}>
            {(p) => <Textarea {...p} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to find this document later" />}
          </Field>
        </section>
        <div className="small muted">Stored only on this computer. Files up to {DOCUMENT_MAX_BYTES / 1024 / 1024} MB are accepted.</div>
      </div>
    </Modal>
  )
}
