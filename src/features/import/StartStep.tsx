import { useRef, useState, type DragEvent } from 'react'
import { FileSpreadsheet, FileText, FileType2, Lock, UploadCloud } from 'lucide-react'
import type { ImportSessionSummary } from '@shared/api/imports'
import { Button } from '@/components/Button'
import { Alert } from '@/components/feedback'
import { Card } from '@/components/layout'
import { api, errorMessage } from '@/services/api'
import { useToast } from '@/components/Toasts'

type Kind = 'qif' | 'csv' | 'excel'

const FORMATS: { kind: Kind; title: string; desc: string; icon: typeof FileText; button: string }[] = [
  {
    kind: 'qif',
    title: 'QIF',
    desc: 'Quicken Interchange Format exported by many banks and finance programs. Payee, memo and category are kept.',
    icon: FileText,
    button: 'Import QIF'
  },
  {
    kind: 'csv',
    title: 'CSV',
    desc: 'A bank statement saved as a spreadsheet text file. You can check and change how the columns are read.',
    icon: FileType2,
    button: 'Import CSV'
  },
  {
    kind: 'excel',
    title: 'Excel',
    desc: 'A statement in .xlsx or .xls format. Pick the sheet and confirm the columns before anything is imported.',
    icon: FileSpreadsheet,
    button: 'Import Excel'
  }
]

const ACCEPT = /\.(qif|csv|txt|tsv|xlsx|xls|xlsm)$/i

export function StartStep({ onOpened }: { onOpened: (s: ImportSessionSummary) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<Kind | 'drop' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const pick = async (kind: Kind) => {
    setBusy(kind)
    setError(null)
    try {
      const summary = await api.import[kind]()
      if (summary) onOpened(summary)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const drop = async (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!ACCEPT.test(file.name)) {
      setError('Ledgerly can import .qif, .csv, .xlsx and .xls files.')
      return
    }
    setBusy('drop')
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      onOpened(await api.import.openBytes({ filename: file.name, bytes }))
    } catch (err) {
      setError(errorMessage(err))
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack lg">
      {error && <Alert kind="danger">{error}</Alert>}

      <div className="imp-start">
        {FORMATS.map((f) => (
          <Card key={f.kind}>
            <div className="imp-format">
              <span className="imp-format-icon">
                <f.icon size={22} aria-hidden />
              </span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <Button variant="primary" icon={UploadCloud} loading={busy === f.kind} disabled={busy !== null} onClick={() => void pick(f.kind)}>
                {f.button}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <div
        className={`imp-drop${over ? ' over' : ''}`}
        role="region"
        aria-label="Drop a statement file here"
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current++
          setOver(true)
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void drop(e)}
      >
        <UploadCloud size={26} aria-hidden />
        <strong>{busy === 'drop' ? 'Reading the file…' : 'Or drop a statement here'}</strong>
        <span className="small">.qif, .csv, .xlsx or .xls — one file at a time</span>
      </div>

      <Card title="How importing works">
        <ol className="imp-steps" style={{ margin: 0, padding: 0 }}>
          <li>
            <span>
              <strong>Select a file</strong>
              It is read on this computer only.
            </span>
          </li>
          <li>
            <span>
              <strong>Review the preview</strong>
              Check totals, duplicates and columns. Nothing is saved yet.
            </span>
          </li>
          <li>
            <span>
              <strong>Confirm</strong>
              Ledgerly adds the new transactions and skips the ones it already has.
            </span>
          </li>
        </ol>
        <div className="row small muted" style={{ marginTop: 14 }}>
          <Lock size={14} aria-hidden /> Statements are never uploaded anywhere. Saved rules are applied to the transactions you import.
        </div>
      </Card>
    </div>
  )
}
