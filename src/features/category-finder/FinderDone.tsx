import { useState } from 'react'
import { ArrowRight, CheckCircle2, ListFilter, ScrollText } from 'lucide-react'
import { categoryLabel } from '@shared/types'
import type { FinderApplyResult, FinderSaveRulesResult, FinderSummary } from '@shared/api/categoryFinder'
import { api, errorMessage } from '@/services/api'
import { useApp } from '@/app/AppContext'
import { Button } from '@/components/Button'
import { Card } from '@/components/layout'
import { Alert } from '@/components/feedback'

interface Props {
  summary: FinderSummary
  result: FinderApplyResult
  onAgain: () => void
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

type SavePhase = 'ask' | 'saving' | 'saved' | 'declined'

/** After Apply: result message, then "Save these keywords as a future rule?". */
export function FinderDone({ summary, result, onAgain }: Props) {
  const app = useApp()
  const [phase, setPhase] = useState<SavePhase>('ask')
  const [saved, setSaved] = useState<FinderSaveRulesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = categoryLabel(result.category)

  const save = async () => {
    setPhase('saving')
    setError(null)
    try {
      const res = await api.categoryFinder.saveRules({ category: result.category, keywords: summary.keywords, wholeWord: summary.wholeWord })
      setSaved(res)
      setPhase('saved')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('ask')
    }
  }

  return (
    <div className="stack lg">
      <Alert kind="success">
        <strong>
          Successfully categorized {plural(result.changed, 'transaction', 'transactions')} as {name}.
        </strong>
        {result.notSelected > 0 && (
          <>
            {'\n'}
            {result.notSelected === 1 ? '1 transaction was not selected.' : `${result.notSelected.toLocaleString()} transactions were not selected.`}
          </>
        )}
        {result.alreadyInCategory > 0 && (
          <>
            {'\n'}
            {result.alreadyInCategory === 1 ? '1 selected transaction was already' : `${result.alreadyInCategory.toLocaleString()} selected transactions were already`} {name} (now protected as a manual choice).
          </>
        )}
      </Alert>

      {phase !== 'declined' && phase !== 'saved' && (
        <Card title="Save these keywords as a future rule?">
          <div className="stack">
            <ul className="rule-preview-list" aria-label="Rules that would be created">
              {summary.keywords.map((k) => (
                <li key={k}>
                  <strong>{k}</strong>
                  <span className="arrow" aria-hidden>
                    →
                  </span>
                  <span className="sr-only">assigns</span>
                  {name}
                </li>
              ))}
            </ul>
            <p className="muted">
              Saved rules automatically categorize <strong>future imports</strong>. They never change your existing transactions by themselves, and you can edit, reorder or delete them
              on the Rules page.
            </p>
            {error && <Alert kind="danger">{error}</Alert>}
            <div className="row">
              <Button variant="primary" loading={phase === 'saving'} onClick={() => void save()}>
                Yes, save as rules
              </Button>
              <Button disabled={phase === 'saving'} onClick={() => setPhase('declined')}>
                No, thanks
              </Button>
            </div>
          </div>
        </Card>
      )}

      {phase === 'saved' && saved && (
        <Alert kind={saved.created.length > 0 ? 'success' : 'info'}>
          <strong>
            {saved.created.length > 0
              ? `Saved ${plural(saved.created.length, 'rule', 'rules')} for future imports.`
              : 'No new rules were needed.'}
          </strong>
          {saved.skipped.map((s) => (
            <span key={s.keyword} style={{ display: 'block' }}>
              {s.reason === 'duplicate'
                ? `“${s.keyword}” already has an identical rule — skipped.`
                : `“${s.keyword}” already has a rule that assigns ${categoryLabel(s.existingCategory ?? '')} — skipped. Edit it on the Rules page if you want to change it.`}
            </span>
          ))}
        </Alert>
      )}
      {phase === 'declined' && <Alert kind="info">No rules were saved. Your categories were applied to the selected transactions only.</Alert>}

      <div className="row wrap">
        <Button variant="primary" icon={ListFilter} onClick={onAgain}>
          Start another search
        </Button>
        <Button icon={ArrowRight} onClick={() => app.navigate('transactions')}>
          View transactions
        </Button>
        {phase === 'saved' && (
          <Button icon={ScrollText} onClick={() => app.navigate('rules')}>
            View rules
          </Button>
        )}
      </div>
      <div className="row muted small" style={{ gap: 6 }}>
        <CheckCircle2 size={14} aria-hidden /> Amounts, dates, merchants and accounts were not changed.
      </div>
    </div>
  )
}
