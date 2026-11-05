import { useRef, useState, type DragEvent } from 'react'
import {
  Download, ExternalLink, FileSpreadsheet, FileText, FileType2, FolderOpen, Image as ImageIcon, Info, Search, Trash2, Upload, X
} from 'lucide-react'
import { DOCUMENT_MAX_BYTES, type DocumentKind, type DocumentRecord, type DocumentStatus } from '@shared/types'
import { PageHeader, Card, Pagination } from '@/components/layout'
import { Button, IconButton } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading, Pill } from '@/components/feedback'
import { Input, Select } from '@/components/form'
import { useToast } from '@/components/Toasts'
import { useConfirm } from '@/components/Confirm'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { useDebounced } from '@/hooks/useDebounced'
import { api, errorMessage } from '@/services/api'
import { formatBytes, plural } from '@/utils/misc'
import { DocumentDetailModal } from './DocumentDetailModal'
import { ACCEPTED_TYPES, KIND_LABELS, STATUS_LABELS, STATUS_TONE, isImageName, isPdfName, isSheetName } from './labels'
import './documents.css'

const PAGE_SIZE = 50

interface Rejection {
  filename: string
  reason: string
}

function FileIcon({ name }: { name: string }) {
  const cls = isPdfName(name) ? 'pdf' : isImageName(name) ? 'image' : isSheetName(name) ? 'sheet' : ''
  const Icon = isPdfName(name) ? FileType2 : isImageName(name) ? ImageIcon : isSheetName(name) ? FileSpreadsheet : FileText
  return (
    <span className={`file-icon ${cls}`} aria-hidden>
      <Icon size={18} />
    </span>
  )
}

export function DocumentsPage() {
  const app = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const [searchText, setSearchText] = useState('')
  const search = useDebounced(searchText, 250)
  const [kind, setKind] = useState<DocumentKind | 'all'>('all')
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [uploadKind, setUploadKind] = useState<DocumentKind | 'auto'>('auto')
  const [dragging, setDragging] = useState(false)
  const [rejections, setRejections] = useState<Rejection[]>([])
  const [detail, setDetail] = useState<DocumentRecord | null>(null)
  const dragDepth = useRef(0)

  const q = useQuery(() => api.documents.list({ search: search || undefined, kind, status, page, pageSize: PAGE_SIZE }), [search, kind, status, page])
  const hasFilters = !!search || kind !== 'all' || status !== 'all'
  const total = q.data?.total ?? 0
  const rows = q.data?.rows ?? []

  const afterChange = () => app.bump()

  const upload = async () => {
    setBusy(true)
    setRejections([])
    try {
      const res = await api.documents.upload(uploadKind === 'auto' ? undefined : { kind: uploadKind })
      if (res.cancelled) return
      setRejections(res.rejected)
      if (res.added.length) toast.success(`${plural(res.added.length, 'document')} added to your local vault.`)
      if (res.added.length || res.rejected.length) afterChange()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setRejections([])
    const rejected: Rejection[] = []
    let added = 0
    for (const file of files) {
      if (file.size > DOCUMENT_MAX_BYTES) {
        rejected.push({ filename: file.name, reason: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Ledgerly accepts files up to 20 MB, so this file was not stored.` })
        continue
      }
      try {
        await api.documents.uploadBytes({
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          kind: uploadKind === 'auto' ? undefined : uploadKind,
          extract: true
        })
        added++
      } catch (e) {
        rejected.push({ filename: file.name, reason: errorMessage(e) })
      }
    }
    setRejections(rejected)
    if (added) toast.success(`${plural(added, 'document')} added to your local vault.`)
    setBusy(false)
    afterChange()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void uploadFiles(Array.from(e.dataTransfer.files))
  }

  const open = async (d: DocumentRecord) => {
    try {
      await api.documents.open({ id: d.id })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const saveCopy = async (d: DocumentRecord) => {
    try {
      if (await api.documents.saveCopy({ id: d.id })) toast.success('A copy was saved.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const remove = async (d: DocumentRecord) => {
    const ok = await confirm({
      title: 'Delete this document?',
      message: `"${d.filename}" will be permanently removed from your local vault.\n\nIf it is attached to a transaction as a receipt, the transaction stays but loses its receipt link.`,
      confirmLabel: 'Delete document',
      danger: true
    })
    if (!ok) return
    try {
      await api.documents.delete({ id: d.id })
      toast.success('Document deleted.')
      afterChange()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const noDocumentsAtAll = !q.loading && total === 0 && !hasFilters
  const reviewCount = rows.filter((r) => r.status === 'review').length

  return (
    <div className="page">
      <PageHeader
        title="Documents"
        subtitle="Keep receipts, invoices and statements in a private vault on this computer. Nothing is uploaded anywhere."
        actions={
          <>
            <label className="row small" style={{ gap: 8 }}>
              <span className="muted nowrap">Upload as</span>
              <Select
                small
                style={{ width: 150 }}
                aria-label="Document type for new uploads"
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value as DocumentKind | 'auto')}
              >
                <option value="auto">Auto-detect</option>
                {(Object.keys(KIND_LABELS) as DocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="primary" icon={Upload} onClick={() => void upload()} loading={busy}>
              Upload Documents
            </Button>
          </>
        }
      />

      {rejections.length > 0 && (
        <Alert
          kind="danger"
          action={<IconButton icon={X} label="Dismiss" size="sm" onClick={() => setRejections([])} />}
        >
          <strong>{plural(rejections.length, 'file')} could not be stored.</strong>
          <ul className="rejected-list">
            {rejections.map((r, i) => (
              <li key={`${r.filename}-${i}`}>{r.reason}</li>
            ))}
          </ul>
        </Alert>
      )}
      {reviewCount > 0 && (
        <Alert kind="warning">
          {plural(reviewCount, 'document')} on this page {reviewCount === 1 ? 'needs' : 'need'} review. Open a document to check what Ledgerly read from it.
        </Alert>
      )}

      <div
        className={`doc-drop${dragging ? ' dragging' : ''}`}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current++
          setDragging(true)
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="drop-hint">Drop files to add them to your vault</div>
        <Card flush>
          {!noDocumentsAtAll && (
            <div className="doc-filters">
              <div className="search-box search" role="search">
                <Search size={16} aria-hidden />
                <Input
                  type="search"
                  placeholder="Search documents"
                  aria-label="Search documents"
                  value={searchText}
                  style={{ paddingLeft: 36 }}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <Select
                small
                style={{ width: 170 }}
                aria-label="Filter by type"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as DocumentKind | 'all')
                  setPage(1)
                }}
              >
                <option value="all">All types</option>
                {(Object.keys(KIND_LABELS) as DocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
              <Select
                small
                style={{ width: 170 }}
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as DocumentStatus | 'all')
                  setPage(1)
                }}
              >
                <option value="all">All statuses</option>
                {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              {hasFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearchText('')
                    setKind('all')
                    setStatus('all')
                    setPage(1)
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {q.error && !q.data ? (
            <ErrorState message={q.error} onRetry={q.reload} />
          ) : q.loading && !q.data ? (
            <Loading label="Loading documents…" />
          ) : noDocumentsAtAll ? (
            <EmptyState
              icon={FolderOpen}
              title="No documents yet"
              action={
                <Button variant="primary" icon={Upload} onClick={() => void upload()} loading={busy}>
                  Upload Documents
                </Button>
              }
            >
              Upload receipts, invoices or statements to keep them in your local vault. You can also drag files onto this page. Each file can be up to 20 MB.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title="No documents match these filters" compact>
              Try a different search or clear the filters.
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Filename</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="num">
                        Size
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col" className="hide-narrow">
                        Source
                      </th>
                      <th scope="col" className="hide-narrow">
                        Imported
                      </th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className="doc-name">
                            <FileIcon name={d.filename} />
                            <div className="names">
                              <div className="fname" title={d.filename}>
                                {d.filename}
                              </div>
                              {d.note && (
                                <div className="note" title={d.note}>
                                  {d.note}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{KIND_LABELS[d.kind]}</td>
                        <td className="num">{formatBytes(d.size)}</td>
                        <td>
                          <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABELS[d.status]}</Pill>
                        </td>
                        <td className="hide-narrow">{d.source === 'import' ? 'Import' : 'Upload'}</td>
                        <td className="hide-narrow nowrap">{app.fmt.dateTime(d.createdAt)}</td>
                        <td className="actions">
                          <IconButton icon={ExternalLink} label={`Open ${d.filename}`} onClick={() => void open(d)} />
                          <IconButton icon={Download} label={`Save a copy of ${d.filename}`} onClick={() => void saveCopy(d)} />
                          <IconButton icon={Info} label={`Details for ${d.filename}`} onClick={() => setDetail(d)} />
                          <IconButton icon={Trash2} label={`Delete ${d.filename}`} danger onClick={() => void remove(d)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} sizes={[PAGE_SIZE]} />
            </>
          )}
        </Card>
      </div>

      <div className="small muted">
        Supported: PDF, images, CSV, Excel (XLS/XLSX), QIF and text files — up to 20 MB each. Accepted types: {ACCEPTED_TYPES.replace(/\./g, '').replace(/,/g, ', ')}.
      </div>

      {detail && (
        <DocumentDetailModal
          doc={detail}
          onClose={() => setDetail(null)}
          onChanged={() => {
            afterChange()
          }}
        />
      )}
    </div>
  )
}
