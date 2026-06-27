import { useEffect, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  hint?: string
  danger?: boolean
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /** 保留触发元素（如编辑器）的选区，供复制/剪切使用 */
  preserveSelection?: boolean
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  preserveSelection,
}: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const estHeight = items.length * 32 + 12
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - estHeight - 8),
  }

  // 保留编辑器选区：阻止菜单上的 mousedown 夺走焦点/清除选区
  const guard = preserveSelection ? (e: React.MouseEvent): void => e.preventDefault() : undefined

  return (
    <div
      className="ctx-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={guard}
    >
      <div
        className="ctx-menu"
        style={style}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={guard}
      >
        {items.map((it, i) => (
          <div key={`${it.label}-${i}`}>
            {it.separatorBefore && <div className="ctx-sep" />}
            <div
              className={`ctx-item${it.danger ? ' danger' : ''}`}
              onMouseDown={guard}
              onClick={() => {
                it.onClick()
                onClose()
              }}
            >
              {it.icon && <span className="ctx-icon">{it.icon}</span>}
              <span className="ctx-item-label">{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
