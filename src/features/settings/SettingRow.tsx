import type { ReactNode } from 'react'

/** A labelled setting: explanation on the left, control on the right. */
export function SettingRow({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <strong>{title}</strong>
        {help && <span>{help}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
