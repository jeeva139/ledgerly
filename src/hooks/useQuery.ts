import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { useApp } from '@/app/AppContext'
import { errorMessage } from '@/services/api'

export interface QueryState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** Re-run the query now. */
  reload: () => void
}

/**
 * Load data through the API and re-load when `deps` or the global data version change.
 * Stale responses are ignored. The previous result stays visible while refreshing (no flicker).
 */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList = []): QueryState<T> {
  const { dataVersion } = useApp()
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reqId = useRef(0)
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true })

  const run = useCallback(() => {
    const id = ++reqId.current
    setState((s) => ({ data: s.data, error: null, loading: true }))
    fnRef.current().then(
      (data) => {
        if (id === reqId.current) setState({ data, error: null, loading: false })
      },
      (e) => {
        if (id === reqId.current) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }))
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion])

  useEffect(() => {
    run()
  }, [run])

  return { ...state, reload: run }
}
