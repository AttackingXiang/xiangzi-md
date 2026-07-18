import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition'

export interface MenuItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  /** 相邻且同组的项目显示为一行紧凑按钮。 */
  compactGroup?: string
}

interface MenuLayoutEntry {
  key: string
  items: MenuItem[]
  compact: boolean
}

function layoutItems(items: MenuItem[]): MenuLayoutEntry[] {
  const result: MenuLayoutEntry[] = []
  for (const [index, item] of items.entries()) {
    const previous = result.at(-1)
    if (item.compactGroup && previous?.key === item.compactGroup && previous.compact) {
      previous.items.push(item)
    } else {
      result.push({
        key: item.compactGroup ?? `item-${index}`,
        items: [item],
        compact: !!item.compactGroup,
      })
    }
  }
  return result
}

export interface ContextMenuData {
  x: number
  y: number
  items: MenuItem[]
  /** 保留触发元素（如编辑器）的选区，供复制/剪切使用 */
  preserveSelection?: boolean
}

export type ContextMenuState = ContextMenuData | null

interface Props extends ContextMenuData {
  onClose: () => void
}

interface ContextMenuTooltip {
  label: string
  anchor: DOMRect
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  preserveSelection,
}: Props): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<ContextMenuTooltip | null>(null)
  const style = useFloatingPanelPosition(menuRef, x, y, 0.8)

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element || !tooltip) return
    const tooltipRect = element.getBoundingClientRect()
    const preferredLeft = tooltip.anchor.left + (tooltip.anchor.width - tooltipRect.width) / 2
    const left = Math.min(window.innerWidth - tooltipRect.width - 8, Math.max(8, preferredLeft))
    const preferredTop = tooltip.anchor.top - tooltipRect.height - 6
    const top = preferredTop >= 8 ? preferredTop : tooltip.anchor.bottom + 6
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }, [tooltip])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const entries = layoutItems(items)
  const showTooltip = (event: React.PointerEvent<HTMLButtonElement>, label: string): void => {
    setTooltip({ label, anchor: event.currentTarget.getBoundingClientRect() })
  }
  const showFocusedTooltip = (event: React.FocusEvent<HTMLButtonElement>, label: string): void => {
    setTooltip({ label, anchor: event.currentTarget.getBoundingClientRect() })
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
        ref={menuRef}
        className="ctx-menu"
        style={style}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={guard}
      >
        {entries.map((entry, entryIndex) => {
          const separator = entry.items.some((item) => item.separatorBefore)
          if (entry.compact) {
            return (
              <div key={`${entry.key}-${entryIndex}`}>
                {separator && <div className="ctx-sep" />}
                <div className="ctx-compact-row" role="group">
                  {entry.items.map((item, itemIndex) => (
                    <button
                      key={`${item.label}-${itemIndex}`}
                      type="button"
                      className={`ctx-compact-item${item.danger ? ' danger' : ''}`}
                      aria-label={item.label}
                      disabled={item.disabled}
                      onPointerEnter={(event) =>
                        showTooltip(event, item.hint ? `${item.label} (${item.hint})` : item.label)
                      }
                      onPointerLeave={() => setTooltip(null)}
                      onFocus={(event) =>
                        showFocusedTooltip(
                          event,
                          item.hint ? `${item.label} (${item.hint})` : item.label,
                        )
                      }
                      onBlur={() => setTooltip(null)}
                      onMouseDown={guard}
                      onClick={() => {
                        setTooltip(null)
                        item.onClick()
                        onClose()
                      }}
                    >
                      {item.icon ?? <span className="ctx-compact-text">{item.label}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )
          }

          const item = entry.items[0]
          if (!item) return null
          return (
            <div key={`${entry.key}-${entryIndex}`}>
              {separator && <div className="ctx-sep" />}
              <button
                type="button"
                className={`ctx-item${item.danger ? ' danger' : ''}`}
                disabled={item.disabled}
                onMouseDown={guard}
                onClick={() => {
                  item.onClick()
                  onClose()
                }}
              >
                {item.icon && <span className="ctx-icon">{item.icon}</span>}
                <span className="ctx-item-label">{item.label}</span>
                {item.hint && <span className="ctx-hint">{item.hint}</span>}
              </button>
            </div>
          )
        })}
      </div>
      {tooltip && (
        <div ref={tooltipRef} className="ctx-tooltip" role="tooltip">
          {tooltip.label}
        </div>
      )}
    </div>
  )
}
