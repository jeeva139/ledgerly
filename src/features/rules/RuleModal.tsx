import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Rule, RuleMatchType } from '@shared/types'
import { api, errorMessage } from '@/services/api'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Alert } from '@/components/feedback'
import { Checkbox, Field, Input, Select } from '@/components/form'
import { CategorySelect } from '@/components/domain'

export const MATCH_TYPE_LABELS: Record<RuleMatchType, string> = {
  contains: 'Contains',
  word: 'Whole word',
  starts_with: 'Starts with',
  equals: 'Equals'
}

const MATCH_TYPE_HELP: Record<RuleMatchType, string> = {
  contains: 'The text appears anywhere in the description, even glued to other letters or numbers.',
  word: 'The text appears as its own word (not inside another word). Digits and punctuation next to it are fine.',
  starts_with: 'The description starts with this text.',
  equals: 'The whole description is exactly this text.'
}

interface Props {
  /** Edit this rule; omit to create a new one. */
  rule?: Rule
  onClose: () => void
  onSaved: (rule: Rule) => void
}

export function RuleModal({ rule, onClose, onSaved }: Props) {
  const [whenText, setWhenText] = useState(rule?.whenText ?? '')
  const [matchType, setMatchType] = useState<RuleMatchType>(rule?.matchType ?? 'contains')
  const [category, setCategory] = useState(rule?.thenText ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const whenError = touched && !whenText.trim() ? 'Enter the text this rule should look for.' : null
  const catError = touched && !category ? 'Choose the category this rule should assign.' : null

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!whenText.trim() || !category) return
    setSaving(true)
    setError(null)
    try {
      const saved = rule
        ? await api.rules.update({ id: rule.id, whenText, thenText: category, matchType, enabled })
        : await api.rules.create({ whenText, thenText: category, matchType, enabled })
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }

  return (
    <Modal
      title={rule ? 'Edit rule' : 'New rule'}
      subtitle="When a transaction’s description matches, assign the category. Applies to future imports."
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={save} onKeyDown={onKeyDown} noValidate>
        <div className="form-grid">
          <Field label="When the description" className="full" error={whenError} required>
            {(f) => (
              <div className="row" style={{ alignItems: 'stretch' }}>
                <Select
                  aria-label="How to match"
                  style={{ width: 150, flex: 'none' }}
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as RuleMatchType)}
                >
                  {(Object.keys(MATCH_TYPE_LABELS) as RuleMatchType[]).map((t) => (
                    <option key={t} value={t}>
                      {MATCH_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <Input {...f} invalid={!!whenError} autoComplete="off" maxLength={200} placeholder="e.g. Netflix" value={whenText} onChange={(e) => setWhenText(e.target.value)} />
              </div>
            )}
          </Field>
          <div className="small muted full" style={{ marginTop: -6 }}>
            {MATCH_TYPE_HELP[matchType]} Upper/lower case is ignored.
          </div>
          <Field label="Then assign the category" className="full" error={catError} required>
            {(f) => <CategorySelect {...f} value={category} onChange={setCategory} allowCreate emptyLabel="Choose a category…" />}
          </Field>
        </div>
        <Checkbox checked={enabled} onChange={setEnabled} label="Rule is enabled" />
        {error && <Alert kind="danger">{error}</Alert>}
      </form>
    </Modal>
  )
}
