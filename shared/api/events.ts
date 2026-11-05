/** Main → renderer event channels the preload bridge allows. */
export const EVENT_CHANNELS = ['menu:action', 'import:progress', 'lock:changed', 'data:changed'] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

/** Payload of `menu:action` (native menu / keyboard accelerators). */
export type MenuAction =
  | 'new-transaction'
  | 'import'
  | 'search'
  | 'backup'
  | 'refresh'
  | 'lock'
  | 'about'
  | 'navigate:dashboard'
  | 'navigate:transactions'
  | 'navigate:category-finder'
  | 'navigate:import'
  | 'navigate:recurring'
  | 'navigate:subscriptions'
  | 'navigate:budgets'
  | 'navigate:goals'
  | 'navigate:reports'
  | 'navigate:documents'
  | 'navigate:rules'
  | 'navigate:settings'

export interface ImportProgressEvent {
  sessionId: string
  phase: 'parsing' | 'checking' | 'importing' | 'done'
  done: number
  total: number
}
