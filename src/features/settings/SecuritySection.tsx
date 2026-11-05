import { useState, type FormEvent } from 'react'
import { KeyRound, Lock, ShieldOff } from 'lucide-react'
import { Card } from '@/components/layout'
import { Button } from '@/components/Button'
import { Alert, ErrorState, Loading } from '@/components/feedback'
import { Field, Input, Select } from '@/components/form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { SettingRow } from './SettingRow'

const MIN_LENGTH = 4

function PinForm({ mode, onDone }: { mode: 'set' | 'change'; onDone: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ current?: string; pin?: string; confirm?: string }>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (mode === 'change' && !current) next.current = 'Enter your current PIN.'
    if (pin.length < MIN_LENGTH) next.pin = `Use at least ${MIN_LENGTH} characters.`
    else if (pin.length > 64) next.pin = 'Use at most 64 characters.'
    if (confirm !== pin) next.confirm = 'The two entries do not match.'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      await api.lock.setPin({ pin, currentPin: mode === 'change' ? current : undefined })
      toast.success(mode === 'set' ? 'Application lock turned on.' : 'PIN changed.')
      setCurrent('')
      setPin('')
      setConfirm('')
      onDone()
    } catch (err) {
      const message = errorMessage(err)
      setErrors(mode === 'change' && /current PIN/i.test(message) ? { current: message } : { pin: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 360 }}>
      {mode === 'change' && (
        <Field label="Current PIN" error={errors.current}>
          {(p) => <Input {...p} type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
      )}
      <Field label={mode === 'set' ? 'PIN or passphrase' : 'New PIN or passphrase'} error={errors.pin} hint={`At least ${MIN_LENGTH} characters.`}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} />}
      </Field>
      <Field label="Repeat it" error={errors.confirm}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" icon={KeyRound} loading={saving}>
          {mode === 'set' ? 'Turn on application lock' : 'Change PIN'}
        </Button>
      </div>
    </form>
  )
}

function RemoveDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!pin) return setError('Enter your current PIN.')
    setBusy(true)
    setError(null)
    try {
      await api.lock.removePin({ pin })
      toast.success('Application lock turned off.')
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="sm"
      title="Turn off the application lock?"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={ShieldOff} loading={busy} onClick={() => void submit()}>
            Turn off lock
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <p>Ledgerly will open without asking for a PIN. Enter your current PIN to confirm.</p>
        <Field label="Current PIN" error={error}>
          {(p) => <Input {...p} type="password" autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />}
        </Field>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Turn off
        </button>
      </form>
    </Modal>
  )
}

export function SecuritySection() {
  const { refreshBoot, lockNow } = useApp()
  const toast = useToast()
  const q = useQuery(() => api.lock.status(), [])
  const [removing, setRemoving] = useState(false)
  const [savingIdle, setSavingIdle] = useState(false)
  const s = q.data

  const changed = () => {
    q.reload()
    void refreshBoot()
  }

  const setIdle = async (minutes: number) => {
    setSavingIdle(true)
    try {
      await api.lock.setIdleMinutes({ minutes })
      toast.success(minutes === 0 ? 'Automatic locking turned off.' : `Ledgerly will lock after ${minutes} idle minutes.`)
      q.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSavingIdle(false)
    }
  }

  return (
    <>
      <Card title="Application lock">
        {q.error && !s ? (
          <ErrorState message={q.error} onRetry={q.reload} />
        ) : !s ? (
          <Loading />
        ) : (
          <div className="stack lg">
            <Alert kind="warning">
              <strong>What the lock does — and does not do.</strong> The application lock asks for a PIN before Ledgerly shows your data. It stops someone from simply opening the app on
              your computer. It does <strong>not encrypt</strong> your database, documents or backups: anyone who can sign in to your Windows account or open the Ledgerly folder can still
              read those files. For stronger protection, use a Windows password and turn on BitLocker or device encryption.
            </Alert>
            {!s.enabled ? (
              <div className="stack">
                <h3>Turn on the application lock</h3>
                <PinForm mode="set" onDone={changed} />
              </div>
            ) : (
              <>
                <div className="row" style={{ color: 'var(--positive-text)' }}>
                  <Lock size={18} aria-hidden />
                  <strong>Application lock is on</strong>
                </div>
                <div className="row wrap">
                  <Button icon={Lock} onClick={() => void lockNow()}>
                    Lock now
                  </Button>
                  <Button variant="outline-danger" icon={ShieldOff} onClick={() => setRemoving(true)}>
                    Turn off lock…
                  </Button>
                </div>
                <SettingRow title="Lock automatically when idle" help="Ledgerly locks after this long without mouse or keyboard activity. The new setting starts the next time Ledgerly is locked or restarted.">
                  <Select
                    aria-label="Lock automatically when idle"
                    style={{ width: 200 }}
                    disabled={savingIdle}
                    value={String(s.idleMinutes)}
                    onChange={(e) => void setIdle(Number(e.target.value))}
                  >
                    <option value="0">Never</option>
                    {[1, 5, 10, 15, 30, 60].map((m) => (
                      <option key={m} value={m}>
                        After {m} {m === 1 ? 'minute' : 'minutes'}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <div className="stack">
                  <h3>Change PIN</h3>
                  <PinForm mode="change" onDone={changed} />
                </div>
              </>
            )}
            <div className="small muted">
              There is no way to recover a forgotten PIN, because Ledgerly cannot contact any service. Keep a backup, and remember your PIN.
            </div>
          </div>
        )}
      </Card>
      {removing && <RemoveDialog onClose={() => setRemoving(false)} onDone={changed} />}
    </>
  )
}
