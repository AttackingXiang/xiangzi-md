import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react'
import type { OutlineItem } from '../types'
import { t } from '../lib/i18n'
import { outlineDescendantEnd, outlineHasChildren, visibleOutlineIndices } from '../lib/outline'

interface Props {
  documentId: string
  items: OutlineItem[]
  activeIndex?: number | null
  onSelect: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClose: () => void
  readOnly?: boolean
  /** 可选宽度覆盖（拖放调整后的动态宽度） */
  width?: number
}

const Outline = memo(function Outline({
  documentId,
  items,
  activeIndex = null,
  onSelect,
  onReorder,
  onClose,
  readOnly = false,
  width,
}: Props): JSX.Element {
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [collapsedByDocument, setCollapsedByDocument] = useState(
    () => new Map<string, Set<number>>(),
  )
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  useEffect(() => {
    if (readOnly) dragCleanupRef.current?.()
  }, [readOnly])

  const collapsed = collapsedByDocument.get(documentId) ?? new Set<number>()
  const updateCollapsed = (update: (next: Set<number>) => void): void => {
    setCollapsedByDocument((current) => {
      const nextMap = new Map(current)
      const next = new Set(current.get(documentId) ?? [])
      update(next)
      nextMap.set(documentId, next)
      return nextMap
    })
  }
  const toggleCollapsed = (index: number, recursive: boolean): void => {
    const closing = !collapsed.has(index)
    updateCollapsed((next) => {
      const end = recursive ? outlineDescendantEnd(items, index) : index + 1
      for (let cursor = index; cursor < end; cursor += 1) {
        if (cursor === index || outlineHasChildren(items, cursor)) {
          if (closing) next.add(cursor)
          else next.delete(cursor)
        }
      }
    })
  }
  const collapsible = items.flatMap((_, index) => (outlineHasChildren(items, index) ? [index] : []))
  const visibleIndices = visibleOutlineIndices(items, collapsed)

  const startDrag = (event: React.PointerEvent<HTMLElement>, fromIndex: number): void => {
    if (readOnly || event.button !== 0) return
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
        <div className="outline-header-actions">
          <button
            className="icon-btn sm"
            onClick={() => updateCollapsed((next) => next.clear())}
            title={t('全部展开')}
            aria-label={t('全部展开')}
            disabled={collapsed.size === 0}
          >
            <ChevronsUpDown size={14} />
          </button>
          <button
            className="icon-btn sm"
            onClick={() =>
              updateCollapsed((next) => collapsible.forEach((index) => next.add(index)))
            }
            title={t('全部收起')}
            aria-label={t('全部收起')}
            disabled={collapsible.length === 0}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button className="icon-btn sm" onClick={onClose} title={t('关闭大纲')}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="outline-body" role="tree" aria-label={t('大纲')}>
        {items.length === 0 ? (
          <p className="outline-empty">{t('暂无标题')}</p>
        ) : (
          visibleIndices.map((i) => {
            const it = items[i]
            if (!it) return null
            const expandable = outlineHasChildren(items, i)
            const isCollapsed = collapsed.has(i)
            return (
              <div
                key={it.index}
                className={`outline-item outline-level-${it.level}${dropTarget === i ? ' drop-target' : ''}${activeIndex === it.index ? ' active' : ''}`}
                data-outline-index={i}
                style={{ paddingLeft: `${(it.level - 1) * 14 + 4}px` }}
                role="treeitem"
                aria-level={it.level}
                aria-current={activeIndex === it.index ? 'location' : undefined}
                aria-expanded={expandable ? !isCollapsed : undefined}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  onSelect(it.index)
                }}
                title={it.text}
              >
                {expandable ? (
                  <button
                    type="button"
                    className="outline-toggle"
                    aria-label={isCollapsed ? t('展开子标题') : t('收起子标题')}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCollapsed(i, event.altKey)
                    }}
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span className="outline-toggle-placeholder" aria-hidden />
                )}
                {!readOnly && (
                  <span
                    className="outline-drag-handle"
                    aria-hidden
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      startDrag(event, i)
                    }}
                  >
                    ⠿
                  </span>
                )}
                <span className="outline-item-label">{it.text || t('（空标题）')}</span>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
})

export default Outline
