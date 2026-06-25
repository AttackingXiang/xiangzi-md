import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 避免超出视口右/下边缘
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 32 - 12)
  }

  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-menu" style={style} onClick={(e) => e.stopPropagation()}>
        {items.map((it, i) => (
          <div key={i}>
            {it.separatorBefore && <div className="ctx-sep" />}
            <div
              className={`ctx-item${it.danger ? ' danger' : ''}`}
              onClick={() => {
                it.onClick()
                onClose()
              }}
            >
              {it.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
