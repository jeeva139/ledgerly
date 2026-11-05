import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { ImportPreferences } from '@shared/types'
import { Card } from '@/components/layout'
import { Alert, ErrorState, Loading } from '@/components/feedback'
import { Switch } from '@/components/form'
import { useToast } from '@/components/Toasts'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { SettingRow } from './SettingRow'

export function ImportSection() {
  const toast = useToast()
  const q = useQuery(() => api.catalog.getImportPreferences(), [])
  const [saving, setSaving] = useState(false)

  const set = async (patch: Partial<ImportPreferences>) => {
    setSaving(true)
    try {
      await api.catalog.setImportPreferences(patch)
      q.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const p = q.data

  return (
    <Card title="Import">
      <p className="muted" style={{ marginBottom: 12 }}>
        These preferences apply to QIF, CSV and Excel imports. You always see a preview before anything is added.
      </p>
      {q.error && !p ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !p ? (
        <Loading />
      ) : (
        <>
          <SettingRow
            title="Keep identical rows that appear more than once in one file"
            help="Two genuinely identical purchases on the same day (for example two teas at the same price) are both imported. Re-importing the same file still adds nothing new."
          >
            <Switch label="Keep repeated identical rows in one file" checked={p.keepRepeatedRows} disabled={saving} onChange={(v) => void set({ keepRepeatedRows: v })} />
          </SettingRow>
          <SettingRow
            title="Let my rules replace categories that came from the file"
            help="Off by default: a category already in the file is kept, and your rules only fill in transactions that have none. Turn on to apply your rules to every imported transaction."
          >
            <Switch label="Let rules override categories from the file" checked={p.rulesOverrideImported} disabled={saving} onChange={(v) => void set({ rulesOverrideImported: v })} />
          </SettingRow>
          <SettingRow
            title="Add new categories found in a file to my list"
            help="When a file uses categories you do not have yet, add them to your category list so you can pick them later."
          >
            <Switch label="Add new categories from imported files" checked={p.addNewCategories} disabled={saving} onChange={(v) => void set({ addNewCategories: v })} />
          </SettingRow>
          <div style={{ marginTop: 16 }}>
            <Alert kind="success">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <ShieldCheck size={16} aria-hidden style={{ marginTop: 2 }} />
                <span>
                  <strong>Duplicate protection is always on.</strong> A transaction with the same date, description, amount and account as one you already have is skipped, so importing the
                  same statement twice never creates duplicates.
                </span>
              </div>
            </Alert>
          </div>
        </>
      )}
    </Card>
  )
}
