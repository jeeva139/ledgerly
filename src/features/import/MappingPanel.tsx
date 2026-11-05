import { CheckCircle2 } from 'lucide-react'
import { MAPPING_FIELDS, MAPPING_LABELS, type ColumnMapping, type ImportOptions, type MappingField, type TableInfo } from '@shared/api/imports'
import { Button } from '@/components/Button'
import { Alert } from '@/components/feedback'
import { Card } from '@/components/layout'
import { Field, Select } from '@/components/form'

interface Props {
  table: TableInfo
  options: ImportOptions
  onChange: (patch: Partial<ImportOptions>) => void
}

const HELP: Partial<Record<MappingField, string>> = {
  amount: 'Use this when one column holds both money in and out (negative = out).',
  debit: 'Use Debit/Credit when the statement has separate columns for money out and money in.',
  drcr: 'Only needed when a column says Dr/Cr or Debit/Credit next to a positive amount.',
  balance: 'Shown for reference; it is not imported.'
}

/**
 * Column mapping for CSV / Excel files. Ledgerly pre-selects what it detected; anything it is not sure about is
 * highlighted and has to be confirmed before the import can start.
 */
export function MappingPanel({ table, options, onChange }: Props) {
  const uncertain = Object.entries(table.uncertain) as [MappingField, string][]
  const setField = (f: MappingField, col: number | null) => onChange({ mapping: { ...(options.mapping ?? {}), [f]: col } })

  const confirmAll = () => {
    const full: Partial<ColumnMapping> = {}
    for (const f of MAPPING_FIELDS) full[f] = table.mapping[f]
    onChange({ mapping: full })
  }

  const mappedCols = new Set(Object.values(table.mapping).filter((v): v is number => v !== null))
  const headerRowValue = options.headerRow ?? 0

  return (
    <Card
      title="Column mapping"
      actions={
        uncertain.length > 0 ? (
          <Button size="sm" variant="primary" icon={CheckCircle2} onClick={confirmAll}>
            Confirm column mapping
          </Button>
        ) : (
          <span className="pill positive">Columns recognised</span>
        )
      }
    >
      <div className="stack">
        {uncertain.length > 0 ? (
          <Alert kind="warning">
            Ledgerly is not sure about {uncertain.length === 1 ? 'one column' : `${uncertain.length} columns`}. Check the highlighted choices below, then confirm.
          </Alert>
        ) : (
          <p className="muted small">Check that each field points to the right column. Change a choice if Ledgerly got it wrong.</p>
        )}

        <div className="imp-map">
          <Field label="Header row" hint="The row that holds the column titles.">
            {(p) => (
              <Select
                {...p}
                value={headerRowValue}
                onChange={(e) => onChange({ headerRow: Number(e.target.value), mapping: undefined })}
              >
                <option value={0}>Detect automatically (row {table.headerRow || 'none'})</option>
                <option value={-1}>No header row — the first row is data</option>
                {table.topRows.map((_, i) => (
                  <option key={i} value={i + 1}>
                    Row {i + 1}: {table.topRows[i].filter(Boolean).slice(0, 3).join(' · ').slice(0, 50) || '(empty)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {MAPPING_FIELDS.map((f) => {
            const msg = table.uncertain[f]
            return (
              <Field key={f} label={MAPPING_LABELS[f]} hint={HELP[f]} error={msg ?? null} className={msg ? 'uncertain' : ''}>
                {(p) => (
                  <Select {...p} value={table.mapping[f] ?? ''} onChange={(e) => setField(f, e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">— not used —</option>
                    {table.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {h}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )
          })}
        </div>

        {table.sampleRows.length > 0 && (
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>
              First rows of the file (mapped columns are highlighted)
            </div>
            <div className="imp-sample table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {table.headers.map((h, i) => (
                      <th key={i} className={mappedCols.has(i) ? 'mapped' : ''}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.sampleRows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
