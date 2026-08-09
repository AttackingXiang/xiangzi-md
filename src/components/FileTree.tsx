import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, LoaderCircle } from 'lucide-react'
import { desktop } from '../platform'
import type { FileNode } from '../types'
import { canDropTreeItem } from '../lib/treeDrag'
import { sortNodes, type SortContext } from '../lib/fileTreeSort'
import { t } from '../lib/i18n'
import { isTypeaheadKey, nextTypeaheadIndex, pushTypeaheadChar } from '../lib/treeTypeahead'
import { FocusedPathContext } from './fileTreeFocusContext'
import { isPathAtOrUnder, sameDocumentPath } from '../lib/pathIdentity'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  /** 当设置后，文件树自动展开祖先目录并滚动到目标文件 */
  revealPath: string | null
  /** 区分连续定位同一个文件的请求 */
  revealRequestId: number | null
  onRevealComplete: (requestId: number) => void
  /** 需要从文件树中隐藏的目录名（完整名称匹配，所有层级） */
  hideFolderNames: string[]
  /** 排序方式 + 置顶集合 + 最近打开排名；逐层套用。 */
  sortContext: SortContext
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  /** Workspace root, so items can be dragged out to the top level. */
  rootPath: string
  depth: number
  /** Set of currently expanded folder paths — used to restore state across remounts. */
  expandedPaths: ReadonlySet<string>
  onToggleExpanded: (path: string, expanded: boolean) => void
  onFocusPath: (path: string) => void
}

function moveTreeFocus(
  current: HTMLElement,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): boolean {
  const container = current.closest<HTMLElement>('[role="tree"]')
  const rows = container
    ? Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    : []
  if (rows.length === 0) return false

  if (key === 'Home') rows[0]?.focus()
  else if (key === 'End') rows[rows.length - 1]?.focus()
  else {
    const index = rows.indexOf(current)
    rows[index + (key === 'ArrowDown' ? 1 : -1)]?.focus()
  }
  return true
}

export default function FileTree({
  nodes,
  activePath,
  revealPath,
  revealRequestId,
  onRevealComplete,
  hideFolderNames,
  sortContext,
  onOpenFile,
  onNodeContext,
  onMove,
  rootPath,
  depth,
  expandedPaths,
  onToggleExpanded,
  onFocusPath,
}: Props): JSX.Element {
  const visible = useMemo(() => {
    const filtered =
      hideFolderNames.length > 0
        ? nodes.filter((n) => !n.isDir || !hideFolderNames.includes(n.name))
        : nodes
    return sortNodes(filtered, sortContext)
  }, [nodes, hideFolderNames, sortContext])

  const focusedPath = useContext(FocusedPathContext)

  return (
    <ul
      className="file-tree"
      role={depth === 0 ? 'tree' : 'group'}
      aria-label={depth === 0 ? t('文件树') : undefined}
    >
      {visible.map((node, index) => {
        // 只有生成 TreeNode 元素的这一层需要知道 focusedPath 的具体值；算出布尔值后
        // 就把它当普通 prop 传下去，未命中的节点两次渲染布尔值都是 false，memo() 能拦下。
        //
        // Roving tabindex: exactly one row in the whole tree is a Tab stop. Once the user has
        // interacted via keyboard/click (focusedPath set), that row wins; before that, default to
        // the active file if it's currently rendered, else the very first row.
        const isFirstRootNode = depth === 0 && index === 0
        const isRovingTabStop =
          focusedPath !== null
            ? sameDocumentPath(focusedPath, node.path)
            : activePath !== null
              ? sameDocumentPath(activePath, node.path)
              : isFirstRootNode
        return (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            revealPath={revealPath}
            revealRequestId={revealRequestId}
            onRevealComplete={onRevealComplete}
            hideFolderNames={hideFolderNames}
            sortContext={sortContext}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            rootPath={rootPath}
            depth={depth}
            expandedPaths={expandedPaths}
            onToggleExpanded={onToggleExpanded}
            onFocusPath={onFocusPath}
            isRovingTabStop={isRovingTabStop}
          />
        )
      })}
    </ul>
  )
}

const TreeNode = memo(function TreeNode({
  node,
  activePath,
  revealPath,
  revealRequestId,
  onRevealComplete,
  hideFolderNames,
  sortContext,
  onOpenFile,
  onNodeContext,
  onMove,
  rootPath,
  depth,
  expandedPaths,
  onToggleExpanded,
  onFocusPath,
  isRovingTabStop,
}: {
  node: FileNode
  activePath: string | null
  revealPath: string | null
  revealRequestId: number | null
  onRevealComplete: (requestId: number) => void
  hideFolderNames: string[]
  sortContext: SortContext
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  rootPath: string
  depth: number
  expandedPaths: ReadonlySet<string>
  onToggleExpanded: (path: string, expanded: boolean) => void
  onFocusPath: (path: string) => void
  /** 是否是整棵树唯一的 Tab 停靠点；由父级 FileTree 算好传入的布尔值，而非 focusedPath
   * 本身——这样命中与未命中的行才能各自独立地被 memo() 挡下，而不是随便一次按键就
   * 让所有节点一起因为 props 变化而重渲染。 */
  isRovingTabStop: boolean
}): JSX.Element {
  // Restore expansion from the persistent set (survives tree remounts on refresh/rename).
  const [expanded, setExpanded] = useState(() => expandedPaths.has(node.path))
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const nodeRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)

  const isActive = activePath !== null && sameDocumentPath(activePath, node.path)
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  const isAncestor =
    node.isDir &&
    revealPath !== null &&
    !sameDocumentPath(revealPath, node.path) &&
    isPathAtOrUnder(revealPath, node.path)

  const isRevealed = revealPath !== null && sameDocumentPath(revealPath, node.path)

  const loadChildren = useCallback(async (): Promise<void> => {
    if (children !== null || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadError(false)
    try {
      const kids = await desktop.readDir(node.path)
      if (mountedRef.current) setChildren(kids)
    } catch {
      if (mountedRef.current) setLoadError(true)
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [children, node.path])

  // If restored as expanded (e.g. after a tree remount), trigger lazy load.
  useEffect(() => {
    if (expanded && children === null) void loadChildren()
    // Run only on mount — expanded/loadChildren are intentionally excluded to
    // avoid re-triggering when the user collapses/re-expands interactively.
  }, [])

  useEffect(() => {
    if (!isAncestor) return
    setExpanded(true)
    onToggleExpanded(node.path, true)
    void loadChildren()
  }, [isAncestor, loadChildren, node.path, onToggleExpanded])

  useEffect(() => {
    if (!isRevealed || revealRequestId === null || !nodeRef.current) return
    nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    onRevealComplete(revealRequestId)
  }, [isRevealed, onRevealComplete, revealRequestId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      dragCleanupRef.current?.()
    }
  }, [])

  const toggle = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    onToggleExpanded(node.path, next)
    if (next) await loadChildren()
  }

  // Pointer events are used instead of HTML5 drag events. WKWebView and WebView2
  // handle native data-transfer drags differently, while pointer events behave
  // consistently on macOS and Windows.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.ctrlKey) return

    dragCleanupRef.current?.()
    const payload = { path: node.path, isDir: node.isDir }
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let dropTarget: HTMLElement | null = null
    let dropTargetPath: string | null = null

    const clearDropTarget = (): void => {
      dropTarget?.classList.remove('drag-over')
      dropTarget = null
      dropTargetPath = null
    }

    const cleanup = (): void => {
      clearDropTarget()
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      window.removeEventListener('blur', handlePointerCancel, true)
      document.body.classList.remove('tree-pointer-dragging')
      setIsDragging(false)
      dragCleanupRef.current = null
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return

      if (!dragging) {
        dragging = true
        setIsDragging(true)
        document.body.classList.add('tree-pointer-dragging')
        window.getSelection()?.removeAllRanges()
      }

      event.preventDefault()
      const under = document.elementFromPoint(event.clientX, event.clientY)
      const dirRow = under?.closest<HTMLElement>('.tree-row.dir[data-tree-path]')
      // Falling outside any folder row but still inside the tree body means
      // "drop at the workspace root" — the way to move a nested item back out
      // to the top level, which has no folder row of its own.
      const rootZone = dirRow ? null : (under?.closest<HTMLElement>('.sidebar-body') ?? null)
      const candidate = dirRow ?? rootZone
      const candidatePath = dirRow ? (dirRow.dataset.treePath ?? null) : rootZone ? rootPath : null

      if (!candidate || !candidatePath || !canDropTreeItem(payload, candidatePath)) {
        clearDropTarget()
        return
      }
      if (candidate === dropTarget) return

      clearDropTarget()
      dropTarget = candidate
      dropTargetPath = candidatePath
      dropTarget.classList.add('drag-over')
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const targetPath = dropTargetPath
      if (dragging) {
        event.preventDefault()
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      cleanup()
      if (dragging && targetPath && canDropTreeItem(payload, targetPath)) {
        void onMove(payload.path, targetPath)
      }
    }

    const handlePointerCancel = (): void => cleanup()

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel, true)
    window.addEventListener('blur', handlePointerCancel, true)
    dragCleanupRef.current = cleanup
  }

  const consumeSuppressedClick = (): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  // Rows are plain divs found via role/data attributes rather than a parallel index — the DOM
  // already mirrors "visible state" exactly, since collapsed directories simply don't render
  // their children (see the `expanded && children...` guard below).
  const findParentRow = (row: HTMLElement): HTMLElement | null => {
    const group = row.closest<HTMLElement>('ul[role="group"]')
    return group?.parentElement?.querySelector<HTMLElement>('.tree-row') ?? null
  }

  const findFirstChildRow = (row: HTMLElement): HTMLElement | null =>
    row.parentElement?.querySelector<HTMLElement>('ul[role="group"] .tree-row') ?? null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // 首字母跳转：长目录里比反复按方向键快得多，是 tree 控件的标准行为。
    if (isTypeaheadKey(e)) {
      const container = e.currentTarget.closest<HTMLElement>('[role="tree"]')
      const rows = container
        ? Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'))
        : []
      if (rows.length === 0) return
      const query = pushTypeaheadChar(e.key)
      const target = nextTypeaheadIndex(
        rows.map((row) => row.dataset.treeName ?? ''),
        rows.indexOf(e.currentTarget),
        query,
      )
      if (target !== null) {
        e.preventDefault()
        rows[target]?.focus()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        if (moveTreeFocus(e.currentTarget, e.key)) e.preventDefault()
        return
      }
      case 'ArrowRight': {
        if (!node.isDir) return
        e.preventDefault()
        if (!expanded) {
          // Children may still be loading (aria-busy); focus intentionally stays on this row
          // rather than guessing at a not-yet-rendered child.
          void toggle()
        } else {
          findFirstChildRow(e.currentTarget)?.focus()
        }
        return
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (node.isDir && expanded) {
          void toggle()
        } else {
          findParentRow(e.currentTarget)?.focus()
        }
        return
      }
      case 'Enter': {
        // Keyboard activation bypasses consumeSuppressedClick() on purpose — that guard only
        // exists to swallow the synthetic click a pointer-drag release generates, which Enter
        // never goes through.
        e.preventDefault()
        if (node.isDir) {
          void toggle()
        } else if (node.openable) {
          onOpenFile(node.path, node.name)
        } else {
          void desktop.openWithDefault(node.path)
        }
        return
      }
      default:
        return
    }
  }

  const handleRetryKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        if (moveTreeFocus(e.currentTarget, e.key)) e.preventDefault()
        return
      }
      case 'ArrowLeft':
        e.preventDefault()
        nodeRef.current?.focus()
        return
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        e.preventDefault()
        void loadChildren()
        return
      default:
        return
    }
  }

  if (node.isDir) {
    // li 上的 role="none" 抹掉隐式 listitem 语义：role=tree 只接受 treeitem/group
    // 作为它拥有的子元素，中间夹一层 listitem 会让部分读屏软件丢失层级关系。
    return (
      <li role="none">
        <div
          ref={nodeRef}
          className={`tree-row dir${isRevealed ? ' reveal-flash' : ''}${isDragging ? ' dragging' : ''}`}
          style={indent}
          data-tree-path={node.path}
          data-tree-name={node.name}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={isActive}
          tabIndex={isRovingTabStop ? 0 : -1}
          aria-grabbed={isDragging}
          aria-expanded={expanded}
          aria-busy={loading}
          onPointerDown={handlePointerDown}
          onFocus={() => onFocusPath(node.path)}
          onKeyDown={handleKeyDown}
          onClick={() => {
            if (!consumeSuppressedClick()) void toggle()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onNodeContext(node, e.clientX, e.clientY)
          }}
        >
          <span className="tree-caret">
            {loading ? (
              <LoaderCircle size={13} className="spin" />
            ) : expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
          <Folder size={15} className="tree-icon" />
          <span className="tree-name">{node.name}</span>
        </div>
        {expanded && children && children.length > 0 && (
          <FileTree
            nodes={children}
            activePath={activePath}
            revealPath={revealPath}
            revealRequestId={revealRequestId}
            onRevealComplete={onRevealComplete}
            hideFolderNames={hideFolderNames}
            sortContext={sortContext}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            rootPath={rootPath}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            onToggleExpanded={onToggleExpanded}
            onFocusPath={onFocusPath}
          />
        )}
        {expanded && children?.length === 0 && !loading && (
          <div className="tree-empty-row" style={{ paddingLeft: `${(depth + 1) * 14 + 27}px` }}>
            {t('空文件夹')}
          </div>
        )}
        {expanded && loadError && !loading && (
          <ul className="file-tree" role="group">
            <li role="none">
              <button
                type="button"
                className="tree-row tree-error-row"
                style={{ paddingLeft: `${(depth + 1) * 14 + 27}px` }}
                data-tree-name={t('读取失败，点击重试')}
                role="treeitem"
                aria-level={depth + 2}
                tabIndex={-1}
                onKeyDown={handleRetryKeyDown}
                onClick={() => void loadChildren()}
              >
                {t('读取失败，点击重试')}
              </button>
            </li>
          </ul>
        )}
      </li>
    )
  }

  return (
    <li role="none">
      <div
        ref={nodeRef}
        className={`tree-row file${node.openable ? '' : ' unsupported'}${isActive ? ' active' : ''}${isRevealed ? ' reveal-flash' : ''}${isDragging ? ' dragging' : ''}`}
        style={indent}
        data-tree-path={node.path}
        data-tree-name={node.name}
        role="treeitem"
        aria-level={depth + 1}
        tabIndex={isRovingTabStop ? 0 : -1}
        aria-selected={isActive}
        aria-grabbed={isDragging}
        title={node.name}
        onPointerDown={handlePointerDown}
        onFocus={() => onFocusPath(node.path)}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (consumeSuppressedClick()) return
          if (node.openable) {
            onOpenFile(node.path, node.name)
          } else {
            void desktop.openWithDefault(node.path)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onNodeContext(node, e.clientX, e.clientY)
        }}
      >
        <span className="tree-caret" />
        <FileText size={15} className="tree-icon" />
        <span className="tree-name">{node.name}</span>
      </div>
    </li>
  )
})
