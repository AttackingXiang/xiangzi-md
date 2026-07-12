import { ArrowLeft, ChevronRight, Star, Tag } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { getLang, t } from '../../../lib/i18n'
import { countTagTreeNodes, flattenTagTree, type TagTreeNode } from '../tagTree'

interface Props {
  tree: TagTreeNode[]
  /** 置顶标签的 key（规范化小写） */
  pinnedTags: string[]
  /** 已折叠分组的 collapseId 集合（主树用 key，置顶区用 `pin:` 前缀）；持久化 */
  collapsedKeys: string[]
  /** 当前选中的标签 key，高亮对应行（其文档在中间结果列展示） */
  activeTag?: string | null
  loading: boolean
  error: string | null
  onClose: () => void
  onOpenTag: (tag: string) => void
  onTogglePin: (key: string) => void
  /** 折叠/展开某个分组（传 collapseId，含 `pin:` 前缀），由上层持久化 */
  onToggleCollapsed: (collapseId: string) => void
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
  collapsedKeys,
  activeTag,
  loading,
  error,
  onClose,
  onOpenTag,
  onTogglePin,
  onToggleCollapsed,
  onTagContext,
  onMoveTag,
}: Props) {
  // 折叠的分组集合由上层持久化传入（默认空 = 全部展开）；切换即回调保存。
  // useMemo：与 App.tsx 里 buildTagTree 的 memo 风格保持一致，避免每次渲染都重建整棵树的派生结构。
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys])
  const [dropKey, setDropKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 选中某个标签（含从正文点标签跳进来）时，把它在左侧标签树里滚动到可见处。
  // 若它的某个祖先分组是折叠的，先展开祖先——这次改动会让 collapsedKeys 变化、
  // 重新触发本 effect，届时目标行已渲染，再滚动过去。
  useEffect(() => {
    if (!activeTag) return
    const parts = activeTag.split('/')
    const collapsedAncestors: string[] = []
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/')
      if (collapsed.has(ancestor)) collapsedAncestors.push(ancestor)
    }
    if (collapsedAncestors.length > 0) {
      for (const ancestor of collapsedAncestors) onToggleCollapsed(ancestor)
      return
    }
    const container = listRef.current
    if (!container) return
    const row = Array.from(
      container.querySelectorAll<HTMLElement>('.tag-tree-row[data-tag-key]'),
    ).find((el) => el.dataset.tagKey === activeTag)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTag, collapsedKeys, onToggleCollapsed])
  // 拖完后短暂压制标签的 click（避免“拖动结束”被当成“点击导航”）。
  const suppressClickRef = useRef(false)
  // 以下派生值都是 O(整棵标签树)，用 useMemo 避免每次渲染（如仅 dropKey 变化）都重算。
  const total = useMemo(() => countTagTreeNodes(tree), [tree])
  const pinnedSet = useMemo(() => new Set(pinnedTags), [pinnedTags])
  const flat = useMemo(() => flattenTagTree(tree), [tree])
  // 已不存在的置顶标签（文档删了/改了标签）自动忽略，不在置顶区显示。
  const pinnedNodes = useMemo(
    () =>
      pinnedTags
        .map((key) => flat.get(key))
        .filter((node): node is TagTreeNode => node !== undefined),
    [pinnedTags, flat],
  )

  const toggleCollapsed = (collapseId: string): void => {
    onToggleCollapsed(collapseId)
  }

  // 用指针事件实现拖动分组（WKWebView 的 HTML5 draggable 不可靠，跟大纲/文件树
  // 一致走 pointer 方案）：拖某个标签落到另一个标签上 → 前者成为后者的子级。
  const startDrag = (event: ReactPointerEvent, dragKey: string): void => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    const targetKeyAt = (x: number, y: number): string | null => {
      const row = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('.tag-tree-row[data-tag-key]')
      return row?.dataset.tagKey ?? null
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.classList.remove('tag-dragging')
      setDropKey(null)
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
        dragging = true
        document.body.classList.add('tag-dragging')
        window.getSelection()?.removeAllRanges()
      }
      e.preventDefault()
      const target = targetKeyAt(e.clientX, e.clientY)
      setDropKey(target && canDrop(dragKey, target) ? target : null)
    }
    const onUp = (e: PointerEvent): void => {
      const wasDragging = dragging
      cleanup()
      if (!wasDragging) return
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      const target = targetKeyAt(e.clientX, e.clientY)
      if (target && canDrop(dragKey, target)) {
        const node = flat.get(target)
        if (node) onMoveTag(dragKey, node.fullLabel)
      }
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
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
      onClick={() => {
        if (suppressClickRef.current) return
        onOpenTag(node.fullLabel)
      }}
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
          className={`tag-overview-item tag-tree-row${dropKey === node.key ? ' drop-target' : ''}${
            activeTag === node.key ? ' active' : ''
          }`}
          style={{ paddingLeft: `${4 + depth * 14}px` }}
          data-tag-key={node.key}
          onPointerDown={(event) => startDrag(event, node.key)}
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
      <div className="tag-overview-list" ref={listRef}>
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
