import { ArrowLeft, Tag } from 'lucide-react'
import { getLang, t } from '../../../lib/i18n'

interface Props {
  tags: Array<{ key: string; label: string; count: number }>
  loading: boolean
  error: string | null
  onClose: () => void
  onOpenTag: (tag: string) => void
}

export default function TagOverviewSidebar({ tags, loading, error, onClose, onOpenTag }: Props) {
  return (
    <div className="tag-panel tag-overview-panel">
      <div className="tag-sidebar-heading">
        <button type="button" className="tag-sidebar-back" onClick={onClose}>
          <ArrowLeft size={14} />
          {t('返回文件')}
        </button>
        <div className="tag-sidebar-title">
          <Tag size={18} />
          <strong>{t('全部标签')}</strong>
        </div>
        <span className="tag-sidebar-count">
          {getLang() === 'en' ? `${tags.length} tags` : `共 ${tags.length} 个标签`}
        </span>
      </div>
      <div className="tag-overview-list">
        {error ? (
          <div className="tag-sidebar-state tag-sidebar-error">{t('标签索引加载失败')}</div>
        ) : loading && tags.length === 0 ? (
          <div className="tag-sidebar-state">{t('正在加载标签索引')}</div>
        ) : tags.length === 0 ? (
          <div className="tag-sidebar-state">{t('当前工作区还没有标签')}</div>
        ) : (
          tags.map((tag) => (
            <button
              type="button"
              key={tag.key}
              className="tag-overview-item"
              onClick={() => onOpenTag(tag.label)}
            >
              <span>#{tag.label}</span>
              <small>{tag.count}</small>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
