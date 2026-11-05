import { useState } from 'react'
import { EyeOff, Undo2 } from 'lucide-react'
import type { Cadence } from '@shared/api/recurring'
import { Card } from '@/components/layout'
import { Button } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Switch } from '@/components/form'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { SettingRow } from './SettingRow'

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Yearly'
}

export function DetectionSection() {
  const { bump, fmt } = useApp()
  const toast = useToast()
  const prefs = useQuery(() => api.catalog.getDetectionPreferences(), [])
  const ignored = useQuery(() => api.recurring.list({ status: 'ignored' }), [])
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const set = async (patch: { recurring?: boolean; subscriptions?: boolean }) => {
    setSaving(true)
    try {
      await api.catalog.setDetectionPreferences(patch)
      prefs.reload()
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const restore = async (key: string) => {
    setRestoring(key)
    try {
      await api.recurring.restore({ key })
      toast.success('Suggestion restored. It will appear in Recurring again.')
      ignored.reload()
      bump()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRestoring(null)
    }
  }

  const p = prefs.data

  return (
    <>
      <Card title="Detection">
        <p className="muted" style={{ marginBottom: 12 }}>
          Ledgerly looks for repeating payments in your own transactions, entirely on this computer. It only <em>suggests</em> — nothing becomes a recurring payment or subscription until
          you choose Keep.
        </p>
        {prefs.error && !p ? (
          <ErrorState message={prefs.error} onRetry={prefs.reload} />
        ) : !p ? (
          <Loading />
        ) : (
          <>
            <SettingRow title="Recurring payment detection" help="Find bills and other payments that repeat weekly, monthly, quarterly or yearly.">
              <Switch label="Recurring payment detection" checked={p.recurring} disabled={saving} onChange={(v) => void set({ recurring: v })} />
            </SettingRow>
            <SettingRow title="Subscription detection" help="Highlight repeating payments that look like subscriptions, such as streaming or software.">
              <Switch label="Subscription detection" checked={p.subscriptions} disabled={saving} onChange={(v) => void set({ subscriptions: v })} />
            </SettingRow>
            {(!p.recurring || !p.subscriptions) && (
              <div style={{ marginTop: 12 }}>
                <Alert kind="info">Turned-off detection hides suggestions on the Recurring and Subscriptions pages. Your decisions are kept.</Alert>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Ignored suggestions">
        <p className="muted" style={{ marginBottom: 12 }}>
          Suggestions you chose to ignore are listed here. Restore one to see it as a suggestion again.
        </p>
        {ignored.error && !ignored.data ? (
          <ErrorState message={ignored.error} onRetry={ignored.reload} />
        ) : ignored.loading && !ignored.data ? (
          <Loading />
        ) : (ignored.data ?? []).length === 0 ? (
          <EmptyState icon={EyeOff} title="Nothing ignored" compact>
            Suggestions you ignore on the Recurring page will appear here.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Payment</th>
                  <th scope="col">Repeats</th>
                  <th scope="col" className="num">
                    Typical amount
                  </th>
                  <th scope="col">Last seen</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(ignored.data ?? []).map((i) => (
                  <tr key={i.key}>
                    <td style={{ fontWeight: 550 }}>{i.merchant}</td>
                    <td>{CADENCE_LABEL[i.cadence]}</td>
                    <td className="num">{fmt.money(i.averageAmount)}</td>
                    <td>{fmt.date(i.lastDate)}</td>
                    <td className="actions">
                      <Button size="sm" icon={Undo2} loading={restoring === i.key} onClick={() => void restore(i.key)}>
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
