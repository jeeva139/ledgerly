import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'outline-danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
  children?: ReactNode
}

/** Standard text button. While `loading` it is disabled and shows a spinner. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon: Icon, loading, children, className = '', disabled, type = 'button', ...rest },
  ref
) {
  const cls = ['btn', variant !== 'default' ? variant : '', size !== 'md' ? size : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} aria-hidden /> : null}
      {children}
    </button>
  )
})

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon
  /** Required: becomes the accessible name and the tooltip. */
  label: string
  size?: 'sm' | 'md'
  danger?: boolean
}

/** Icon-only button. Always has an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', danger, className = '', type = 'button', ...rest },
  ref
) {
  const cls = ['icon-btn', size === 'sm' ? 'sm' : '', danger ? 'danger' : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} aria-label={label} title={label} {...rest}>
      <Icon size={size === 'sm' ? 15 : 18} aria-hidden />
    </button>
  )
})
