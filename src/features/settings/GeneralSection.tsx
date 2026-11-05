import { useState } from 'react'
import { CURRENCIES } from '@shared/money'
import { formatDate, todayISO } from '@shared/dates'
import type { DateFormat, Preferences, ThemeChoice } from '@shared/types'
import { Card } from '@/components/layout'
import { Select, Segmented } from '@/components/form'
import { useApp } from '@/app/AppContext'
import { useToast } from '@/components/Toasts'
import { SettingRow } from './SettingRow'

export function GeneralSection() {
  const { prefs, updatePrefs } = useApp()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const today = todayISO()

  const save = async (patch: Partial<Preferences>) => {
    setSaving(true)
    try {
      await updatePrefs(patch)
      toast.success('Preference saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="General">
      <div aria-busy={saving}>
        <SettingRow title="Currency" help="Used to display every amount. Existing amounts are not converted.">
          <Select aria-label="Currency" style={{ width: 240 }} disabled={saving} value={prefs.currency} onChange={(e) => void save({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow title="Date format" help="How dates are shown throughout Ledgerly.">
          <Select
            aria-label="Date format"
            style={{ width: 240 }}
            disabled={saving}
            value={prefs.dateFormat}
            onChange={(e) => void save({ dateFormat: e.target.value as DateFormat })}
          >
            {(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as DateFormat[]).map((f) => (
              <option key={f} value={f}>
                {f} — e.g. {formatDate(today, f)}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow title="First day of the week" help="Used when weeks are shown.">
          <Select
            aria-label="First day of the week"
            style={{ width: 240 }}
            disabled={saving}
            value={String(prefs.firstDayOfWeek)}
            onChange={(e) => void save({ firstDayOfWeek: Number(e.target.value) as 0 | 1 | 6 })}
          >
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
            <option value="6">Saturday</option>
          </Select>
        </SettingRow>
        <SettingRow title="Theme" help="System follows your Windows light/dark setting.">
          <Segmented<ThemeChoice>
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => void save({ theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ]}
          />
        </SettingRow>
        <SettingRow title="When Ledgerly starts" help="Choose which page opens first.">
          <Select
            aria-label="Startup behavior"
            style={{ width: 240 }}
            disabled={saving}
            value={prefs.startupPage}
            onChange={(e) => void save({ startupPage: e.target.value as Preferences['startupPage'] })}
          >
            <option value="dashboard">Open the Dashboard</option>
            <option value="last">Reopen the last page I used</option>
          </Select>
        </SettingRow>
      </div>
    </Card>
  )
}
