import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ListFilter } from 'lucide-react'
import type { FinderApplyResult, FinderSummary } from '@shared/api/categoryFinder'
import { api, errorMessage } from '@/services/api'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/feedback'
import { Card, PageHeader } from '@/components/layout'
import { FinderSetup } from './FinderSetup'
import { FinderResults } from './FinderResults'
import { FinderDone } from './FinderDone'
import './finder.css'

type Stage = { kind: 'setup' } | { kind: 'results'; summary: FinderSummary } | { kind: 'done'; summary: FinderSummary; result: FinderApplyResult }

const STEPS = ['Category & keywords', 'Preview & select', 'Apply & save rule']

export function CategoryFinderPage() {
  const app = useApp()
  const params = app.route.params
  const [stage, setStage] = useState<Stage>({ kind: 'setup' })
  const [category, setCategory] = useState(typeof params.category === 'string' ? params.category : '')
  const [keywordText, setKeywordText] = useState(typeof params.keywords === 'string' ? params.keywords : '')
  const [wholeWord, setWholeWord] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server-side preview is released when leaving the page or starting over.
  const sessionRef = useRef<string | null>(null)
  const release = useCallback(() => {
    const id = sessionRef.current
    sessionRef.current = null
    if (id) void api.categoryFinder.cancel({ sessionId: id }).catch(() => undefined)
  }, [])
  useEffect(() => release, [release])

  const search = async () => {
    setSearching(true)
    setError(null)
    release()
    try {
      const summary = await api.categoryFinder.search({ category, keywords: keywordText, wholeWord })
      sessionRef.current = summary.sessionId
      setStage({ kind: 'results', summary })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  const backToSetup = () => {
    release()
    setStage({ kind: 'setup' })
  }

  const reset = () => {
    release()
    setCategory('')
    setKeywordText('')
    setWholeWord(false)
    setError(null)
    setStage({ kind: 'setup' })
  }

  const stepIndex = stage.kind === 'setup' ? 0 : stage.kind === 'results' ? 1 : 2
  const noData = app.boot.counts.transactions === 0

  return (
    <div className="page">
      <PageHeader
        title="Category Finder"
        subtitle="Find transactions by the words in their description, review them, then assign a category to all of them at once."
        actions={
          stage.kind !== 'setup' && (
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
          )
        }
      />

      {noData && stage.kind === 'setup' ? (
        <Card>
          <EmptyState
            icon={ListFilter}
            title="No transactions yet"
            action={
              <div className="row">
                <Button variant="primary" icon={Download} onClick={() => app.navigate('import')}>
                  Import a statement
                </Button>
                <Button onClick={() => app.openAddEntry()}>Add an entry</Button>
              </div>
            }
          >
            Category Finder searches the transactions you already have. Import a bank statement or add your first transaction, then come back to categorize them in bulk.
          </EmptyState>
        </Card>
      ) : (
        <>
          <ol className="finder-steps" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label} className={`finder-step${i < stepIndex ? ' done' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
                <span className="num" aria-hidden>
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>

          {stage.kind === 'setup' && (
            <FinderSetup
              category={category}
              onCategory={setCategory}
              keywordText={keywordText}
              onKeywordText={setKeywordText}
              wholeWord={wholeWord}
              onWholeWord={setWholeWord}
              onSearch={() => void search()}
              searching={searching}
              error={error}
            />
          )}
          {stage.kind === 'results' && (
            <FinderResults
              summary={stage.summary}
              onBack={backToSetup}
              onApplied={(result) => {
                sessionRef.current = null // consumed by apply
                setStage({ kind: 'done', summary: stage.summary, result })
              }}
            />
          )}
          {stage.kind === 'done' && <FinderDone summary={stage.summary} result={stage.result} onAgain={reset} />}
        </>
      )}
    </div>
  )
}
