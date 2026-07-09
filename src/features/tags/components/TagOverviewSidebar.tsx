import { ArrowLeft, ChevronRight, Star, Tag } from 'lucide-react'
import { useRef, useState } from 'react'
import { getLang, t } from '../../../lib/i18n'
import { countTagTreeNodes, flattenTagTree, type TagTreeNode } from '../tagTree'

interface Props {
  tree: TagTreeNode[]
  /** 置顶标签的 key（规范化小写） */
  pinnedTags: string[]
  loading: boolean
  error: string | null
  onClose: () => void
  onOpenTag: (tag: string) => void
  onTogglePin: (key: string) => void
  /** 右键某个标签（改名/改分组） */
  onTagContext: (key: string, fullLabel: string, x: number, y: number) => void
  /** 把 dragKey 拖到 targetFullLabel 下面（快速分组） */
  onMoveTag: (dragKey: string, targetFullLabel: string) => void
}

/** 不能把标签拖到它自己或它的后代上（会造成循环）。 */
function canDrop(dragKey: string, targetKey: string): boolean {
  return dragKey !== targetKey && !targetKey.startsWith(`${dragKey}/`)
}

export default function TagOverviewSidebar({
  tree,
  pinnedTags,
  loading,
  error,
  onClose,
  onOpenTag,
  onTogglePin,
  onTagContext,
  onMoveTag,
}: Props) {
  // 折叠的分组 key 集合；默认全部展开。仅存在于本次会话（不跨重开持久化）。
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  // 正在拖动的标签 key（dragover 里判断能否落下时需要它，用 ref 避免频繁重渲染）。
  const draggingKeyRef = useRef<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const total = countTagTreeNodes(tree)
  const pinnedSet = new Set(pinnedTags)
  const flat = flattenTagTree(tree)
  // 已不存在的置顶标签（文档删了/改了标签）自动忽略，不在置顶区显示。
  const pinnedNodes = pinnedTags
    .map((key) => flat.get(key))
    .filter((node): node is TagTreeNode => node !== undefined)

  const toggleCollapsed = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const pinButton = (key: string): JSX.Element => {
    const pinned = pinnedSet.has(key)
    return (
      <button
        type="button"
        className={`tag-pin-btn${pinned ? ' pinned' : ''}`}
        aria-label={pinned ? t('取消置顶') : t('置顶')}
        title={pinned ? t('取消置顶') : t('置顶')}
        onClick={(event) => {
          event.stopPropagation()
          onTogglePin(key)
        }}
      >
        <Star size={13} fill={pinned ? 'currentColor' : 'none'} />
      </button>
    )
  }

  // 标签名按钮：标签图标 + 名称，点击导航到该标签（父标签含所有子标签的文档）。
  const tagLabel = (node: TagTreeNode, useFullLabel: boolean): JSX.Element => (
    <button
      type="button"
      className="tag-tree-label"
      onClick={() => onOpenTag(node.fullLabel)}
      title={node.fullLabel}
    >
      <Tag size={12} className="tag-tree-icon" />
      <span className="tag-tree-name">{useFullLabel ? node.fullLabel : node.segment}</span>
    </button>
  )

  // prefix 让置顶区和主树的折叠状态互不影响（同一个标签在两处能各自展开/折叠）。
  // rootFullLabel 只让置顶区顶层那一行显示完整路径（AI/日常），子级仍显示片段。
  const renderNode = (
    node: TagTreeNode,
    depth: number,
    prefix = '',
    rootFullLabel = false,
  ): JSX.Element => {
    const hasChildren = node.children.length > 0
    const collapseId = prefix + node.key
    const isCollapsed = collapsed.has(collapseId)
    return (
      <div key={collapseId} className="tag-tree-node">
        <div
          className={`tag-overview-item tag-tree-row${dropKey === node.key ? ' drop-target' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          draggable
          onDragStart={(event) => {
            draggingKeyRef.current = node.key
            event.dataTransfer.setData('application/x-xmd-tag', node.key)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            draggingKeyRef.current = null
            setDropKey(null)
          }}
          onDragOver={(event) => {
            const dragging = draggingKeyRef.current
            if (!dragging || !canDrop(dragging, node.key)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (dropKey !== node.key) setDropKey(node.key)
          }}
          onDragLeave={() => setDropKey((k) => (k === node.key ? null : k))}
          onDrop={(event) => {
            event.preventDefault()
            const dragging =
              event.dataTransfer.getData('application/x-xmd-tag') || draggingKeyRef.current
            draggingKeyRef.current = null
            setDropKey(null)
            if (dragging && canDrop(dragging, node.key)) onMoveTag(dragging, node.fullLabel)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onTagContext(node.key, node.fullLabel, event.clientX, event.clientY)
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`tag-tree-toggle${isCollapsed ? '' : ' expanded'}`}
              onClick={() => toggleCollapsed(collapseId)}
              aria-label={isCollapsed ? t('展开') : t('折叠')}
            >
              <ChevronRight size={13} />
            </button>
          ) : (
            <span className="tag-tree-toggle-spacer" aria-hidden="true" />
          )}
          {tagLabel(node, rootFullLabel && depth === 0)}
          <small>{node.totalCount}</small>
          {pinButton(node.key)}
        </div>
        {hasChildren && !isCollapsed && (
          <div className="tag-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1, prefix))}
          </div>
        )}
      </div>
    )
  }

  const hasTags = tree.length > 0

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
        ) : loading && !hasTags ? (
          <div className="tag-sidebar-state">{t('正在加载标签索引')}</div>
        ) : !hasTags ? (
          <div className="tag-sidebar-state">{t('当前工作区还没有标签')}</div>
        ) : (
          <>
            {pinnedNodes.length > 0 && (
              <div className="tag-pinned-section">
                <div className="tag-section-label">{t('已置顶')}</div>
                {pinnedNodes.map((node) => renderNode(node, 0, 'pin:', true))}
              </div>
            )}
            {tree.map((node) => renderNode(node, 0))}
          </>
        )}
      </div>
    </div>
  )
}
