import { useEffect, useState } from 'react'

export interface ChartColors {
  grid: string
  axis: string
  text: string
  muted: string
  surface: string
  accent: string
  positive: string
  spending: string
  info: string
  /** Eight categorical slots in fixed order (`--chart-1…8`). */
  series: string[]
}

function read(): ChartColors {
  const cs = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs?.getPropertyValue(name).trim() || fallback
  return {
    grid: v('--grid', '#e8ebf1'),
    axis: v('--border-strong', '#cfd4de'),
    text: v('--text', '#1a2033'),
    muted: v('--text-muted', '#566078'),
    surface: v('--surface', '#ffffff'),
    accent: v('--chart-1', '#6558d3'),
    positive: v('--positive', '#1f8f5b'),
    spending: v('--spending', '#e07a2d'),
    info: v('--info', '#2f6fbf'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--chart-${i}`, '#6558d3'))
  }
}

/**
 * Design-token colours resolved to real values (SVG fills can't rely on CSS variables everywhere).
 * Re-reads whenever the theme changes (light / dark / system).
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read)
  useEffect(() => {
    const update = () => setColors(read())
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    update()
    return () => {
      obs.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])
  return colors
}
