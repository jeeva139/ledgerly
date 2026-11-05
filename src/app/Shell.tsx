import { useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus, Search, ShieldCheck, X } from 'lucide-react'
import { PERIODS, type PeriodId } from '@shared/types'
import { useApp } from './AppContext'
import { PAGES, isPageId, type PageId } from './pages'
import { PAGE_COMPONENTS } from './pageRegistry'
import { Logo } from '@/components/Logo'
import { Button, IconButton } from '@/components/Button'
import { Select } from '@/components/form'
import { Modal } from '@/components/Modal'
import { AddEntryHost } from '@/features/transactions/AddEntryHost'
import { api, events } from '@/services/api'
import type { MenuAction } from '@shared/api'
import { useDebounced } from '@/hooks/useDebounced'

export function Shell({ onLocked }: { onLocked: () => void }) {
  const app = useApp()
  const { route, boot, prefs, navigate, searchInputRef } = app
  const Page = PAGE_COMPONENTS[route.page]
  const pageDef = PAGES.find((p) => p.id === route.page)!
  const [searchText, setSearchText] = useState(app.search)
  const debounced = useDebounced(searchText, 250)

  // Debounced global search → transactions page.
  const lastSent = useRef(app.search)
  useEffect(() => {
    if (debounced !== lastSent.current) {
      lastSent.current = debounced
      app.setSearch(debounced)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])
  useEffect(() => {
    // External changes (e.g. a page clearing the search) update the box.
    if (app.search !== lastSent.current) {
      lastSent.current = app.search
      setSearchText(app.search)
    }
  }, [app.search])

  // Native menu / accelerators.
  useEffect(() => {
    return events.on('menu:action', (payload) => {
      const action = payload as MenuAction
      if (action === 'new-transaction') app.openAddEntry()
      else if (action === 'import') navigate('import')
      else if (action === 'search') {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (action === 'backup') navigate('settings', { section: 'backup' })
      else if (action === 'refresh') app.bump()
      else if (action === 'lock') void app.lockNow()
      else if (action === 'about') app.setShowAbout(true)
      else if (action.startsWith('navigate:')) {
        const id = action.slice('navigate:'.length)
        if (isPageId(id)) navigate(id as PageId)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.bump, app.lockNow, app.openAddEntry, navigate])

  // Idle auto-lock (only when a lock is configured with an idle timeout).
  useEffect(() => {
    if (!boot.lock.enabled) return
    let timer: number | undefined
    let minutes = 0
    const reset = () => {
      window.clearTimeout(timer)
      if (minutes > 0) timer = window.setTimeout(() => void app.lockNow(), minutes * 60_000)
    }
    void api.lock.status().then((s) => {
      minutes = s.idleMinutes
      reset()
    })
    const evts = ['mousemove', 'keydown', 'mousedown', 'wheel']
    evts.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      evts.forEach((e) => window.removeEventListener(e, reset))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.lock.enabled])

  void onLocked
  const collapsed = prefs.sidebarCollapsed

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <Logo size={36} />
          <div className="brand-text">
            <div className="brand-name">Ledgerly</div>
            <div className="brand-tag">Private Personal Finance</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {PAGES.map((p) => {
            const Icon = p.icon
            return (
              <div key={p.id} style={{ display: 'contents' }}>
                {p.groupStart && <div className="nav-sep" role="separator" />}
                <button
                  className={`nav-item${p.featured ? ' featured' : ''}`}
                  aria-current={route.page === p.id ? 'page' : undefined}
                  onClick={() => navigate(p.id)}
                  title={p.label}
                  aria-label={p.label}
                >
                  <span className="nav-icon">
                    <Icon size={p.featured ? 16 : 19} aria-hidden />
                  </span>
                  <span className="nav-label">{p.label}</span>
                  {p.featured && <span className="nav-badge">Smart</span>}
                </button>
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="privacy-chip" title="Your financial data stays on this computer. Ledgerly never connects to the internet.">
            <ShieldCheck size={18} aria-hidden />
            <div className="privacy-text">
              <strong>Offline &amp; private</strong>
              Your data stays on this computer.
            </div>
          </div>
          <button
            className="collapse-btn"
            onClick={() => void app.updatePrefs({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
            <span>Collapse</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="search-box" role="search">
            <Search size={16} aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search transactions…  (Ctrl+F)"
              aria-label="Search transactions"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  lastSent.current = searchText
                  app.setSearch(searchText)
                } else if (e.key === 'Escape') {
                  setSearchText('')
                }
              }}
            />
            {searchText && (
              <span className="clear">
                <IconButton icon={X} size="sm" label="Clear search" onClick={() => setSearchText('')} />
              </span>
            )}
          </div>
          <div className="spacer" />
          {pageDef.usesPeriod && (
            <label className="row small" style={{ gap: 8 }}>
              <span className="muted nowrap">Period</span>
              <Select
                small
                style={{ width: 150 }}
                value={app.period}
                aria-label="Date period"
                onChange={(e) => void app.setPeriod(e.target.value as PeriodId)}
              >
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button variant="primary" icon={Plus} onClick={() => app.openAddEntry()} title="Add entry (Ctrl+N)">
            Add Entry
          </Button>
        </div>
        <main className="content" id="main-content">
          <Page key={route.page} />
        </main>
      </div>

      <AddEntryHost />
      {app.showAbout && <AboutDialog onClose={() => app.setShowAbout(false)} />}
    </div>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const { boot } = useApp()
  const shortcuts: [string, string][] = [
    ['Ctrl+N', 'New transaction'],
    ['Ctrl+I', 'Import a statement'],
    ['Ctrl+F', 'Search transactions'],
    ['Ctrl+S', 'Save (in dialogs and forms)'],
    ['Ctrl+B', 'Create a backup'],
    ['Ctrl+R', 'Refresh data'],
    ['Ctrl+L', 'Lock Ledgerly'],
    ['Esc', 'Close dialog']
  ]
  return (
    <Modal title="About Ledgerly" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="stack lg">
        <div className="row" style={{ gap: 14 }}>
          <Logo size={56} />
          <div>
            <h2>Ledgerly</h2>
            <div className="muted">Private Personal Finance · Version {boot.appVersion}</div>
          </div>
        </div>
        <p>
          Ledgerly keeps your financial data on this computer. It works completely offline, has no cloud account, no sync and no
          telemetry, and never connects to the internet.
        </p>
        <div>
          <h3 style={{ marginBottom: 8 }}>Keyboard shortcuts</h3>
          <div className="stack sm">
            {shortcuts.map(([k, d]) => (
              <div key={k} className="row between">
                <span>{d}</span>
                <span className="kbd">{k}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="small muted">Data location: {boot.dataLocation}</div>
      </div>
    </Modal>
  )
}
