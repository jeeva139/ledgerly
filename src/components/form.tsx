import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface FieldRenderProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: (props: FieldRenderProps) => ReactNode
}

/** Label + control + hint/error, wired for accessibility. Pass the control as a render function. */
export function Field({ label, hint, error, required, className = '', children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <div className="hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="error" id={errId} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean; invalid?: boolean }>(function Input(
  { small, invalid, className = '', ...rest },
  ref
) {
  return <input ref={ref} className={`input${small ? ' sm' : ''}${invalid ? ' invalid' : ''} ${className}`} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean; invalid?: boolean }>(function Select(
  { small, invalid, className = '', children, ...rest },
  ref
) {
  return (
    <select ref={ref} className={`select${small ? ' sm' : ''}${invalid ? ' invalid' : ''} ${className}`} {...rest}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`textarea ${className}`} {...rest} />
})

export function Checkbox({ checked, onChange, label, disabled, indeterminate }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  indeterminate?: boolean
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label !== undefined && <span>{label}</span>}
    </label>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; className?: string }[]
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.className} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Numeric text input that keeps the raw string (so "12." and "" are editable) and reports a number or null. */
export const MoneyInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (raw: string) => void
  invalid?: boolean
}>(function MoneyInput({ value, onChange, invalid, ...rest }, ref) {
  return (
    <Input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      invalid={invalid}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.,\-]/g, '')
        onChange(v)
      }}
      {...rest}
    />
  )
})

/** "1,234.50" → 1234.5 ; "" / garbage → null */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
