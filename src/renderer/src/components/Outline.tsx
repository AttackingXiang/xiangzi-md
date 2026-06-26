import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { OutlineItem } from '../types'
import { t } from '../lib/i18n'

interface Props {
  items: OutlineItem[]
  onSelect: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClose: () => void
}

export default function Outline({ items, onSelect, onReorder, onClose }: Props): JSX.Element {
  const dragSrc = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const handleDragStart = (e: React.DragEvent, i: number): void => {
    dragSrc.current = i
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, i: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(i)
  }

  const handleDrop = (e: React.DragEvent, i: number): void => {
    e.preventDefault()
    setDropTarget(null)
    const from = dragSrc.current
    if (from === null || from === i) return
    dragSrc.current = null
    onReorder(from, i)
  }

  const handleDragEnd = (): void => {
    dragSrc.current = null
    setDropTarget(null)
  }

  return (
    <aside className="outline">
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
              style={{ paddingLeft: `${(it.level - 1) * 12 + 12}px` }}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelect(it.index)}
              title={it.text}
            >
              <span className="outline-drag-handle" aria-hidden>⠿</span>
              {it.text || t('（空标题）')}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
