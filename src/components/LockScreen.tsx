import { useState, type FormEvent } from 'react'
import { LockKeyhole } from 'lucide-react'
import { Logo } from './Logo'
import { Button } from './Button'
import { Field, Input } from './form'
import { api, errorMessage } from '@/services/api'

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pin) return
    setBusy(true)
    setError(null)
    try {
      await api.lock.unlock({ pin })
      setPin('')
      onUnlocked()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <div className="brandrow">
          <Logo size={44} />
          <div style={{ textAlign: 'left' }}>
            <h1 style={{ fontSize: 22 }}>Ledgerly</h1>
            <div className="muted small">Private Personal Finance</div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'center', color: 'var(--accent-text)' }}>
          <LockKeyhole size={20} aria-hidden />
          <strong>Ledgerly is locked</strong>
        </div>
        <Field label="PIN" error={error}>
          {(p) => <Input {...p} type="password" autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Enter your PIN" />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!pin}>
          Unlock
        </Button>
      </form>
    </div>
  )
}
