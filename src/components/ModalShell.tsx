import type { ReactNode } from 'react'
import { useModalFocus } from '../hooks/useModalFocus'

interface Props {
  children: ReactNode
  className: string
  backdropClassName?: string
  labelledBy?: string
  label?: string
  onBackdrop?: () => void
  onEscape?: () => void
}

/**
 * Shared modal boundary: focus containment, topmost-only Escape handling and
 * backdrop dismissal all follow the same rules across application dialogs.
 */
export default function ModalShell({
  children,
  className,
  backdropClassName,
  labelledBy,
  label,
  onBackdrop,
  onEscape,
}: Props): JSX.Element {
  const dialogRef = useModalFocus<HTMLDivElement>(true, onEscape)

  return (
    <div
      className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBackdrop?.()
      }}
    >
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
