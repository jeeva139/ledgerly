import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus } from 'lucide-react'
import './transactions.css'

interface TagPopoverProps {
  /** Element the popover is attached to (the "+" button). */
  anchor: HTMLElement
  /** Every tag that exists. */
  allTags: string[]
  /** Tags already on the target transaction(s) (shown as ticked in "toggle" mode). */
  selected?: string[]
  /** "toggle": pick several, each click adds/removes. "add": one pick adds the tag and closes. */
  mode: 'toggle' | 'add'
  title?: string
  onPick: (name: string, on: boolean) => void
  onClose: () => void
}

const POPOVER_W = 264
const POPOVER_H = 330

/**
 * Tag-only picker: choose existing tags or type a new name. Creating a tag needs nothing but its name.
 * Rendered in a portal with fixed positioning so table scrolling never clips it.
 */
export function TagPopover({ anchor, allTags, selected = [], mode, title = 'Tags', onPick, onClose }: TagPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - 8))
    const below = r.bottom + 6
    const top = below + POPOVER_H > window.innerHeight ? Math.max(8, r.top - POPOVER_H - 6) : below
    setPos({ top, left })
  }, [anchor])

  useEffect(() => {
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchor.focus()
      }
    }
    const onScrollOrResize = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  const query = text.trim()
  const selectedLower = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected])
  const filtered = useMemo(
    () => allTags.filter((t) => t.toLowerCase().includes(query.toLowerCase())).slice(0, 60),
    [allTags, query]
  )
  const exact = allTags.find((t) => t.toLowerCase() === query.toLowerCase())
  const canCreate = query.length > 0 && !exact

  const pick = (name: string) => {
    const on = mode === 'add' ? true : !selectedLower.has(name.toLowerCase())
    onPick(name, on)
    if (mode === 'add') onClose()
    else setText('')
  }

  return createPortal(
    <div ref={ref} className="tx-popover" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={title}>
      <input
        ref={inputRef}
        className="input sm"
        placeholder="Find or add a tag…"
        aria-label="Tag name"
        maxLength={40}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!query) return
            pick(exact ?? query)
          }
        }}
      />
      <div className="list" role="listbox" aria-label="Tags" aria-multiselectable={mode === 'toggle'}>
        {canCreate && (
          <button type="button" className="opt" role="option" aria-selected={false} onClick={() => pick(query)}>
            <span className="box" style={{ borderStyle: 'dashed' }}>
              <Plus size={11} aria-hidden />
            </span>
            <span className="truncate">Add “{query}”</span>
          </button>
        )}
        {filtered.map((t) => {
          const on = selectedLower.has(t.toLowerCase())
          return (
            <button key={t} type="button" className="opt" role="option" aria-checked={on} aria-selected={on} onClick={() => pick(t)}>
              <span className="box">{on && <Check size={11} aria-hidden />}</span>
              <span className="truncate">{t}</span>
            </button>
          )
        })}
        {filtered.length === 0 && !canCreate && (
          <div className="hint">{allTags.length === 0 ? 'No tags yet. Type a name to create the first one.' : 'No tags match.'}</div>
        )}
      </div>
    </div>,
    document.body
  )
}
