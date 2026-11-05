import { useState } from 'react'
import type { ImportReport, ImportSessionSummary } from '@shared/api/imports'
import { PageHeader, Tabs } from '@/components/layout'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api } from '@/services/api'
import { StartStep } from './StartStep'
import { ReviewStep } from './ReviewStep'
import { ReportStep } from './ReportStep'
import { HistoryTab } from './HistoryTab'
import './import.css'

type Stage =
  | { kind: 'start' }
  | { kind: 'review'; summary: ImportSessionSummary }
  | { kind: 'report'; report: ImportReport }

export function ImportPage() {
  const app = useApp()
  const [tab, setTab] = useState<'import' | 'history'>(app.route.params.tab === 'history' ? 'history' : 'import')
  const [stage, setStage] = useState<Stage>({ kind: 'start' })
  const history = useQuery(() => api.import.history(), [])
  const historyCount = history.data?.length ?? 0

  const subtitle =
    stage.kind === 'start'
      ? 'Bring in a bank or card statement. Files are read on this computer only, and you review everything before anything is saved.'
      : stage.kind === 'review'
        ? 'Check the preview. Nothing is saved until you choose Import Transactions.'
        : undefined

  return (
    <div className="page">
      <PageHeader title="Import" subtitle={subtitle} />
      <Tabs
        label="Import sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'import', label: 'Import statement' },
          { id: 'history', label: `Import history${historyCount ? ` (${historyCount})` : ''}` }
        ]}
      />
      {tab === 'history' ? (
        <HistoryTab />
      ) : stage.kind === 'start' ? (
        <StartStep onOpened={(summary) => setStage({ kind: 'review', summary })} />
      ) : stage.kind === 'review' ? (
        <ReviewStep
          key={stage.summary.sessionId}
          summary={stage.summary}
          onCancel={() => setStage({ kind: 'start' })}
          onDone={(report) => setStage({ kind: 'report', report })}
        />
      ) : (
        <ReportStep report={stage.report} onAnother={() => setStage({ kind: 'start' })} />
      )}
    </div>
  )
}
