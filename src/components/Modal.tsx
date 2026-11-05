import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './Button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Action buttons (rendered in the sticky footer). */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** When false, Escape / the X button are ignored (e.g. while saving). */
  dismissible?: boolean
}

/**
 * Accessible dialog: portal, focus trap, Escape to close, visible close button,
 * focus returns to the previously focused element on close.
 */
export function Modal({ title, subtitle, onClose, children, footer, size = 'md', dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    // Focus the first form control, else the first focusable element, else the dialog itself.
    const first = node?.querySelector<HTMLElement>('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])')
    ;(first ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const node = ref.current
      if (!node) return
      // Only the top-most dialog reacts.
      const dialogs = document.querySelectorAll('.overlay')
      if (dialogs[dialogs.length - 1] !== node.parentElement) return
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dismissible])

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div ref={ref} className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head">
          <div className="grow">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} disabled={!dismissible} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
