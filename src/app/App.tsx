import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { BootstrapState } from '@shared/types'
import { ToastProvider } from '@/components/Toasts'
import { ConfirmProvider } from '@/components/Confirm'
import { LockScreen } from '@/components/LockScreen'
import { Logo } from '@/components/Logo'
import { Spinner, Alert } from '@/components/feedback'
import { Button } from '@/components/Button'
import { api, bridgeAvailable, errorMessage, events } from '@/services/api'
import { AppProvider, type Route } from './AppContext'
import { Shell } from './Shell'
import { isPageId } from './pages'

type Phase =
  | { kind: 'loading' }
  | { kind: 'no-bridge' }
  | { kind: 'locked' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; boot: BootstrapState; route: Route }

async function load(): Promise<Phase> {
  if (!bridgeAvailable()) return { kind: 'no-bridge' }
  try {
    const lock = await api.lock.status()
    if (lock.locked) return { kind: 'locked' }
    const boot = await api.catalog.bootstrap()
    let page = 'dashboard'
    if (boot.preferences.startupPage === 'last') {
      const last = await api.catalog.getLastPage().catch(() => null)
      if (isPageId(last)) page = last
    }
    return { kind: 'ready', boot, route: { page: isPageId(page) ? page : 'dashboard', params: {} } }
  } catch (e) {
    return { kind: 'error', message: errorMessage(e) }
  }
}

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Root />
      </ConfirmProvider>
    </ToastProvider>
  )
}

function Root() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const start = useCallback(() => {
    setPhase({ kind: 'loading' })
    void load().then(setPhase)
  }, [])
  useEffect(start, [start])

  // The main process can lock the app (menu / idle) — follow it.
  useEffect(() => events.on('lock:changed', () => start()), [start])

  if (phase.kind === 'loading') {
    return (
      <div className="splash">
        <div className="splash-card">
          <Logo size={56} />
          <Spinner large label="Opening your ledger" />
          <div className="muted">Opening your ledger…</div>
        </div>
      </div>
    )
  }
  if (phase.kind === 'no-bridge') {
    return (
      <div className="splash">
        <div className="splash-card">
          <Logo size={56} />
          <h1>Open Ledgerly as a desktop app</h1>
          <p className="muted">This page needs the Ledgerly desktop application. Start Ledgerly from the Start menu or run it with Electron.</p>
        </div>
      </div>
    )
  }
  if (phase.kind === 'error') {
    return (
      <div className="splash">
        <div className="splash-card" style={{ maxWidth: 520 }}>
          <AlertTriangle size={40} color="var(--danger)" aria-hidden />
          <Alert kind="danger">{phase.message}</Alert>
          <Button variant="primary" onClick={start}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
  if (phase.kind === 'locked') return <LockScreen onUnlocked={start} />

  return (
    <AppProvider initialBoot={phase.boot} initialRoute={phase.route} onLocked={() => setPhase({ kind: 'locked' })}>
      <Shell onLocked={() => setPhase({ kind: 'locked' })} />
    </AppProvider>
  )
}
