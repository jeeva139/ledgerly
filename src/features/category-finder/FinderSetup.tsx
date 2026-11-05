import { useMemo } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { parseKeywords } from '@shared/matching'
import { Alert } from '@/components/feedback'
import { Button } from '@/components/Button'
import { Card } from '@/components/layout'
import { Checkbox, Field, Textarea } from '@/components/form'
import { CategorySelect } from '@/components/domain'

interface Props {
  category: string
  onCategory: (c: string) => void
  keywordText: string
  onKeywordText: (t: string) => void
  wholeWord: boolean
  onWholeWord: (v: boolean) => void
  onSearch: () => void
  searching: boolean
  error: string | null
}

/** Steps 1 and 2: choose the category, enter keywords. Nothing is searched until the user clicks Search. */
export function FinderSetup(p: Props) {
  const keywords = useMemo(() => parseKeywords(p.keywordText), [p.keywordText])
  const ready = p.category !== '' && keywords.length > 0

  return (
    <div className="grid cols-21">
      <Card>
        <form
          className="stack lg"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !p.searching) p.onSearch()
          }}
        >
          <Field label="What category should matching transactions be assigned to?">
            {(f) => (
              <CategorySelect
                {...f}
                value={p.category}
                onChange={p.onCategory}
                allowCreate
                emptyLabel="Choose a category…"
              />
            )}
          </Field>

          <Field
            label="Enter keywords"
            hint={
              <>
                Separate multiple keywords with commas.
                <br />
                Example: <span className="mono">Tea, Briyani, Dosa, Dinner, Lunch, Breakfast</span>
              </>
            }
          >
            {(f) => (
              <Textarea
                {...f}
                rows={3}
                placeholder="Tea, Briyani, Dosa, Dinner, Lunch, Breakfast"
                value={p.keywordText}
                maxLength={10000}
                onChange={(e) => p.onKeywordText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && !p.searching) {
                    e.preventDefault()
                    p.onSearch()
                  }
                }}
              />
            )}
          </Field>

          {keywords.length > 0 && (
            <div className="stack sm" aria-live="polite">
              <div className="small muted">
                {keywords.length} {keywords.length === 1 ? 'keyword' : 'keywords'} (duplicates and blanks removed)
              </div>
              <div className="kw-chips">
                {keywords.map((k) => (
                  <span key={k.toLowerCase()} className="kw-chip">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="stack sm">
            <Checkbox checked={p.wholeWord} onChange={p.onWholeWord} label="Match whole words only" />
            <div className="small muted" style={{ marginLeft: 24 }}>
              Off by default: “tea” also finds “STEAK” and “LUNCHUPI”. Turn this on to skip matches glued to other letters (digits and punctuation are fine).
            </div>
          </div>

          {p.error && <Alert kind="danger">{p.error}</Alert>}

          <div className="row end">
            <Button type="submit" variant="primary" size="lg" icon={Search} loading={p.searching} disabled={!ready}>
              Search transactions
            </Button>
          </div>
        </form>
      </Card>

      <Card title="How it works">
        <div className="finder-howto">
          <ul>
            <li>
              <CheckCircle2 size={18} aria-hidden />
              <span>
                <strong>Nothing changes until you click Apply.</strong> You review every match first and can untick any of them.
              </span>
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden />
              <span>Searches the full wording of every transaction, ignoring upper/lower case — even inside long UPI or bank narrations.</span>
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden />
              <span>Transactions you categorized by hand are protected: they are listed but unticked.</span>
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden />
              <span>Afterwards you can save the keywords as rules for future imports.</span>
            </li>
            <li>
              <CheckCircle2 size={18} aria-hidden />
              <span>Everything runs on this computer. Nothing is sent anywhere.</span>
            </li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
