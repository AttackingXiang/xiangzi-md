import { memo, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { OutlineItem } from '../types'
import { t } from '../lib/i18n'

interface Props {
  items: OutlineItem[]
  onSelect: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClose: () => void
  /** 可选宽度覆盖（拖放调整后的动态宽度） */
  width?: number
}

const Outline = memo(function Outline({
  items,
  onSelect,
  onReorder,
  onClose,
  width,
}: Props): JSX.Element {
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, fromIndex: number): void => {
    if (event.button !== 0) return
    dragCleanupRef.current?.()
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    let targetIndex: number | null = null

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      window.removeEventListener('blur', handlePointerCancel, true)
      document.body.classList.remove('outline-pointer-dragging')
      setDropTarget(null)
      dragCleanupRef.current = null
    }

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
        return
      }
      if (!dragging) {
        dragging = true
        document.body.classList.add('outline-pointer-dragging')
        window.getSelection()?.removeAllRanges()
      }
      moveEvent.preventDefault()
      const candidate = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest<HTMLElement>('.outline-item[data-outline-index]')
      const parsed = candidate ? Number(candidate.dataset.outlineIndex) : Number.NaN
      targetIndex = Number.isInteger(parsed) ? parsed : null
      setDropTarget(targetIndex)
    }

    const handlePointerUp = (upEvent: PointerEvent): void => {
      const target = targetIndex
      if (dragging) {
        upEvent.preventDefault()
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      cleanup()
      if (dragging && target !== null && target !== fromIndex) onReorder(fromIndex, target)
    }

    const handlePointerCancel = (): void => cleanup()

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel, true)
    window.addEventListener('blur', handlePointerCancel, true)
    dragCleanupRef.current = cleanup
  }

  return (
    <aside className="outline" style={width !== undefined ? { width } : undefined}>
      <div className="outline-header">
        <span>{t('大纲')}</span>
        <button className="icon-btn sm" onClick={onClose} title={t('关闭大纲')}>
          <X size={14} />
        </button>
      </div>
      <div className="outline-body">
        {items.length === 0 ? (
          <p className="outline-empty">{t('暂无标题')}</p>
        ) : (
          items.map((it, i) => (
            <div
              key={it.index}
              className={`outline-item${dropTarget === i ? ' drop-target' : ''}`}
              data-outline-index={i}
              style={{ paddingLeft: `${(it.level - 1) * 10 + 4}px` }}
              onPointerDown={(event) => startDrag(event, i)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onSelect(it.index)
              }}
              title={it.text}
            >
              <span className="outline-drag-handle" aria-hidden>
                ⠿
              </span>
              {it.text || t('（空标题）')}
            </div>
          ))
        )}
      </div>
    </aside>
  )
})

export default Outline
