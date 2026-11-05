import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn | null>(null)

/** `const confirm = useConfirm(); if (await confirm({ title: 'Delete?', danger: true })) …` */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => setPending({ options, resolve })), [])
  const close = (result: boolean) => {
    pending?.resolve(result)
    setPending(null)
  }
  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {pending && (
        <Modal
          size="sm"
          title={pending.options.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>{pending.options.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={pending.options.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {pending.options.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          {pending.options.message && <div style={{ whiteSpace: 'pre-line' }}>{pending.options.message}</div>}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}
