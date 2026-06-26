import { X } from 'lucide-react'
import type { OutlineItem } from '../types'
import { t } from '../lib/i18n'

interface Props {
  items: OutlineItem[]
  onSelect: (index: number) => void
  onClose: () => void
}

export default function Outline({ items, onSelect, onClose }: Props): JSX.Element {
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
          items.map((it) => (
            <div
              key={it.index}
              className="outline-item"
              style={{ paddingLeft: `${(it.level - 1) * 12 + 12}px` }}
              onClick={() => onSelect(it.index)}
              title={it.text}
            >
              {it.text || t('（空标题）')}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
