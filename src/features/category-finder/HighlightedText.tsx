import { snippetAround } from '@shared/matching'
import type { FinderKeywordHit } from '@shared/api/categoryFinder'

/** Up to this length the whole narration is shown with every hit highlighted; longer text is cut around the first hit. */
const FULL_LIMIT = 260

function mergeHits(hits: FinderKeywordHit[]): { start: number; end: number }[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start)
  const out: { start: number; end: number }[] = []
  for (const h of sorted) {
    const last = out[out.length - 1]
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end)
    else out.push({ start: h.start, end: h.end })
  }
  return out
}

/** Transaction text with the matched keyword(s) highlighted. */
export function HighlightedText({ text, hits }: { text: string; hits: FinderKeywordHit[] }) {
  if (hits.length === 0) return <>{text}</>
  if (text.length > FULL_LIMIT) {
    const first = [...hits].sort((a, b) => a.start - b.start)[0]
    const s = snippetAround(text, first.start, first.end, 70)
    return (
      <>
        {s.before}
        <mark className="hit">{s.match}</mark>
        {s.after}
      </>
    )
  }
  const parts: React.ReactNode[] = []
  let pos = 0
  mergeHits(hits).forEach((m, i) => {
    if (m.start > pos) parts.push(text.slice(pos, m.start))
    parts.push(
      <mark key={i} className="hit">
        {text.slice(m.start, m.end)}
      </mark>
    )
    pos = m.end
  })
  if (pos < text.length) parts.push(text.slice(pos))
  return <>{parts}</>
}
