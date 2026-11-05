// Deterministic colours for categories / accounts (consistent across charts and pills).
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)']

export function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Subcategories share their parent's colour. */
export function categoryColor(name: string): string {
  const top = name.split(':')[0].trim().toLowerCase()
  return PALETTE[hashString(top) % PALETTE.length]
}

export const chartColor = (i: number): string => PALETTE[i % PALETTE.length]
