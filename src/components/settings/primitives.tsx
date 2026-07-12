import type { ReactNode } from 'react'

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="settings-page">
      <div className="settings-page-title">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}

export function SettingsCard({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="settings-card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  )
}

export function SettingRow({
  label,
  description,
  children,
}: {
  label: ReactNode
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="settings-row">
      {description ? (
        <span className="settings-row-copy">
          <span className="settings-label">{label}</span>
          <small>{description}</small>
        </span>
      ) : (
        <span className="settings-label">{label}</span>
      )}
      {children}
    </label>
  )
}

export function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className={`settings-row settings-toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="settings-row-copy">
        <span className="settings-label">{label}</span>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}
