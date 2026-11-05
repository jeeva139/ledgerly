import { useState, type FormEvent } from 'react'
import { Card } from '@/components/layout'
import { Button } from '@/components/Button'
import { Alert } from '@/components/feedback'
import { Field, MoneyInput, parseMoney } from '@/components/form'
import { useConfirm } from '@/components/Confirm'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'

export function NetWorthSection() {
  const { boot, refreshBoot, bump, fmt } = useApp()
  const toast = useToast()
  const confirm = useConfirm()
  const nw = boot.netWorth
  const [assets, setAssets] = useState(nw.configured ? String(nw.assets) : '')
  const [liabilities, setLiabilities] = useState(nw.configured ? String(nw.liabilities) : '')
  const [errors, setErrors] = useState<{ assets?: string; liabilities?: string }>({})
  const [saving, setSaving] = useState(false)

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    const a = assets.trim() === '' ? 0 : parseMoney(assets)
    const l = liabilities.trim() === '' ? 0 : parseMoney(liabilities)
    const next: typeof errors = {}
    if (a === null || a < 0) next.assets = 'Enter zero or a positive number.'
    if (l === null || l < 0) next.liabilities = 'Enter zero or a positive number.'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      await api.catalog.setNetWorth({ assets: a!, liabilities: l! })
      toast.success('Net worth saved.')
      await refreshBoot()
      bump()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear net worth?',
      message: 'Ledgerly will go back to showing “Not set” for net worth. Your transactions are not affected.',
      confirmLabel: 'Clear net worth',
      danger: true
    })
    if (!ok) return
    try {
      await api.catalog.clearNetWorth()
      setAssets('')
      setLiabilities('')
      toast.success('Net worth cleared.')
      await refreshBoot()
      bump()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card title="Net worth">
      <div className="stack lg">
        <div>
          <div className="muted small">Current net worth</div>
          <div style={{ fontSize: 26, fontWeight: 650 }} aria-live="polite">
            {nw.configured ? fmt.money(nw.assets - nw.liabilities) : <span className="muted">Not set</span>}
          </div>
        </div>
        <Alert kind="info">
          Net worth is <strong>total assets − total liabilities</strong>, using the two figures you enter here. Ledgerly never works it out from your transactions, and it never
          assumes a value.
        </Alert>
        <form className="form-grid" onSubmit={save}>
          <Field label="Total assets" error={errors.assets} hint="Savings, investments, property and anything else you own.">
            {(p) => <MoneyInput {...p} value={assets} onChange={setAssets} placeholder="0.00" />}
          </Field>
          <Field label="Total liabilities" error={errors.liabilities} hint="Loans, credit card balances and anything else you owe.">
            {(p) => <MoneyInput {...p} value={liabilities} onChange={setLiabilities} placeholder="0.00" />}
          </Field>
          <div className="row full">
            <Button type="submit" variant="primary" loading={saving}>
              Save net worth
            </Button>
            {nw.configured && (
              <Button onClick={() => void clear()} disabled={saving}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </div>
    </Card>
  )
}
