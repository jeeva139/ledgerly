import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { BootstrapState, PeriodId, Preferences } from '@shared/types'
import { formatDate, formatDateTime } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { api, errorMessage } from '@/services/api'
import { useToast } from '@/components/Toasts'
import type { PageId } from './pages'

export interface Route {
  page: PageId
  /** Page-specific parameters passed by `navigate` (e.g. filters). Consumers read what they understand. */
  params: Record<string, unknown>
}

export interface AddEntryRequest {
  /** Values to pre-fill (e.g. from a document). Never fake data. */
  prefill?: Record<string, unknown>
  key: number
}

interface Formatters {
  money: (amount: number, opts?: { sign?: boolean; compact?: boolean }) => string
  date: (iso: string | null | undefined) => string
  dateTime: (ts: string) => string
}

export interface AppContextValue {
  boot: BootstrapState
  /** Re-read categories, accounts, tags, preferences, net worth and counts. */
  refreshBoot: () => Promise<void>
  /** Incremented after any data mutation; `useQuery` re-runs when it changes. */
  dataVersion: number
  bump: () => void
  route: Route
  navigate: (page: PageId, params?: Record<string, unknown>) => void
  /** Global transaction search text (top bar). */
  search: string
  setSearch: (s: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  period: PeriodId
  setPeriod: (p: PeriodId) => Promise<void>
  prefs: Preferences
  updatePrefs: (patch: Partial<Preferences>) => Promise<void>
  fmt: Formatters
  addEntry: AddEntryRequest | null
  openAddEntry: (prefill?: Record<string, unknown>) => void
  closeAddEntry: () => void
  lockNow: () => Promise<void>
  showAbout: boolean
  setShowAbout: (v: boolean) => void
}

const Ctx = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside <AppProvider>')
  return v
}

interface ProviderProps {
  initialBoot: BootstrapState
  initialRoute: Route
  onLocked: () => void
  children: ReactNode
}

export function AppProvider({ initialBoot, initialRoute, onLocked, children }: ProviderProps) {
  const toast = useToast()
  const [boot, setBoot] = useState(initialBoot)
  const [dataVersion, setDataVersion] = useState(0)
  const [route, setRoute] = useState<Route>(initialRoute)
  const [search, setSearchState] = useState('')
  const [addEntry, setAddEntry] = useState<AddEntryRequest | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const addEntryKey = useRef(0)

  const refreshBoot = useCallback(async () => {
    try {
      setBoot(await api.catalog.bootstrap())
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [toast])

  const bump = useCallback(() => {
    setDataVersion((v) => v + 1)
    void refreshBoot()
  }, [refreshBoot])

  const navigate = useCallback((page: PageId, params: Record<string, unknown> = {}) => {
    setRoute({ page, params })
    void api.catalog.setLastPage({ page }).catch(() => undefined)
  }, [])

  const setSearch = useCallback(
    (s: string) => {
      setSearchState(s)
      if (s.trim() && route.page !== 'transactions') navigate('transactions')
    },
    [navigate, route.page]
  )

  const setPeriod = useCallback(
    async (p: PeriodId) => {
      try {
        await api.catalog.setPeriod({ period: p })
        setBoot((b) => ({ ...b, selectedPeriod: p }))
        setDataVersion((v) => v + 1)
      } catch (e) {
        toast.error(errorMessage(e))
      }
    },
    [toast]
  )

  const updatePrefs = useCallback(
    async (patch: Partial<Preferences>) => {
      try {
        const prefs = await api.catalog.setPreferences(patch)
        setBoot((b) => ({ ...b, preferences: prefs }))
      } catch (e) {
        toast.error(errorMessage(e))
      }
    },
    [toast]
  )

  const lockNow = useCallback(async () => {
    try {
      await api.lock.lockNow()
      onLocked()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [onLocked, toast])

  const prefs = boot.preferences
  const fmt = useMemo<Formatters>(
    () => ({
      money: (n, opts) => formatMoney(n, prefs.currency, opts),
      date: (iso) => formatDate(iso, prefs.dateFormat),
      dateTime: (ts) => formatDateTime(ts, prefs.dateFormat)
    }),
    [prefs.currency, prefs.dateFormat]
  )

  // Theme: light / dark / follow system.
  useEffect(() => {
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (prefs.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [prefs.theme])

  const value: AppContextValue = {
    boot,
    refreshBoot,
    dataVersion,
    bump,
    route,
    navigate,
    search,
    setSearch,
    searchInputRef,
    period: boot.selectedPeriod,
    setPeriod,
    prefs,
    updatePrefs,
    fmt,
    addEntry,
    openAddEntry: (prefill) => setAddEntry({ prefill, key: ++addEntryKey.current }),
    closeAddEntry: () => setAddEntry(null),
    lockNow,
    showAbout,
    setShowAbout
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
