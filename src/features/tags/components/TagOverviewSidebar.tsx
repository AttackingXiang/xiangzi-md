import { ArrowLeft, ChevronRight, Tag } from 'lucide-react'
import { useState } from 'react'
import { getLang, t } from '../../../lib/i18n'
import { countTagTreeNodes, type TagTreeNode } from '../tagTree'

interface Props {
  tree: TagTreeNode[]
  loading: boolean
  error: string | null
  onClose: () => void
  onOpenTag: (tag: string) => void
}

export default function TagOverviewSidebar({ tree, loading, error, onClose, onOpenTag }: Props) {
  // 折叠的分组 key 集合；默认全部展开。仅存在于本次会话（不跨重开持久化）。
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const total = countTagTreeNodes(tree)

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderNode = (node: TagTreeNode, depth: number): JSX.Element => {
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.key)
    return (
      <div key={node.key} className="tag-tree-node">
        <div
          className="tag-overview-item tag-tree-row"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`tag-tree-toggle${isCollapsed ? '' : ' expanded'}`}
              onClick={() => toggle(node.key)}
              aria-label={isCollapsed ? t('展开') : t('折叠')}
            >
              <ChevronRight size={13} />
            </button>
          ) : (
            <span className="tag-tree-toggle-spacer" aria-hidden="true" />
          )}
          {/* 每个节点都可点击导航；点父标签会展示它 + 所有子标签的文档（见 App 里的
              聚合），所以计数统一用 totalCount（子树去重后的文档总数）。 */}
          <button
            type="button"
            className={`tag-tree-label${hasChildren ? ' tag-tree-group' : ''}`}
            onClick={() => onOpenTag(node.fullLabel)}
            title={`#${node.fullLabel}`}
          >
            #{node.segment}
          </button>
          <small>{node.totalCount}</small>
        </div>
        {hasChildren && !isCollapsed && (
          <div className="tag-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

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
          {getLang() === 'en' ? `${total} tags` : `共 ${total} 个标签`}
        </span>
      </div>
      <div className="tag-overview-list">
        {error ? (
          <div className="tag-sidebar-state tag-sidebar-error">{t('标签索引加载失败')}</div>
        ) : loading && tree.length === 0 ? (
          <div className="tag-sidebar-state">{t('正在加载标签索引')}</div>
        ) : tree.length === 0 ? (
          <div className="tag-sidebar-state">{t('当前工作区还没有标签')}</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  )
}
