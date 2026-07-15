import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition'

const MAX = 8

interface Props {
  x: number
  y: number
  onInsert: (rows: number, cols: number) => void
  onClose: () => void
}

export default function TableGridPicker({ x, y, onInsert, onClose }: Props): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState({ r: 0, c: 0 })
  const style = useFloatingPanelPosition(panelRef, x, y)

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as globalThis.Node)) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = hover.r && hover.c ? `${hover.r} × ${hover.c} ${t('表格')}` : t('插入表格')

  return (
    <div
      ref={panelRef}
      className="table-picker-panel"
      style={style}
      onMouseLeave={() => setHover({ r: 0, c: 0 })}
    >
      <div className="table-picker-label">{label}</div>
      <div className="table-picker-grid">
        {Array.from({ length: MAX }, (_, ri) =>
          Array.from({ length: MAX }, (_, ci) => (
            <div
              key={`${ri}-${ci}`}
              className={`table-picker-cell${ri < hover.r && ci < hover.c ? ' active' : ''}`}
              onMouseEnter={() => setHover({ r: ri + 1, c: ci + 1 })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onInsert(ri + 1, ci + 1)
                onClose()
              }}
            />
          )),
        )}
      </div>
    </div>
  )
}
