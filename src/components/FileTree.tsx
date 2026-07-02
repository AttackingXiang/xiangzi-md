import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, LoaderCircle } from 'lucide-react'
import { desktop } from '../platform'
import type { FileNode } from '../types'
import { canDropTreeItem } from '../lib/treeDrag'
import { t } from '../lib/i18n'

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
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  depth: number
}

export default function FileTree({
  nodes,
  activePath,
  revealPath,
  revealRequestId,
  onRevealComplete,
  hideFolderNames,
  onOpenFile,
  onNodeContext,
  onMove,
  depth,
}: Props): JSX.Element {
  const visible =
    hideFolderNames.length > 0
      ? nodes.filter((n) => !n.isDir || !hideFolderNames.includes(n.name))
      : nodes

  return (
    <ul className="file-tree">
      {visible.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          activePath={activePath}
          revealPath={revealPath}
          revealRequestId={revealRequestId}
          onRevealComplete={onRevealComplete}
          hideFolderNames={hideFolderNames}
          onOpenFile={onOpenFile}
          onNodeContext={onNodeContext}
          onMove={onMove}
          depth={depth}
        />
      ))}
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
  onOpenFile,
  onNodeContext,
  onMove,
  depth,
}: {
  node: FileNode
  activePath: string | null
  revealPath: string | null
  revealRequestId: number | null
  onRevealComplete: (requestId: number) => void
  hideFolderNames: string[]
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  depth: number
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null)
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const nodeRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)

  const isActive = activePath === node.path
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  const isAncestor =
    node.isDir &&
    revealPath !== null &&
    (revealPath.startsWith(node.path + '/') || revealPath.startsWith(node.path + '\\'))

  const isRevealed = revealPath === node.path

  const loadChildren = useCallback(async (): Promise<void> => {
    if (children !== null || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const kids = await desktop.readDir(node.path)
      if (mountedRef.current) setChildren(kids)
    } catch {
      if (mountedRef.current) setChildren([])
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [children, node.path])

  useEffect(() => {
    if (!isAncestor) return
    setExpanded(true)
    void loadChildren()
  }, [isAncestor, loadChildren])

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
      const candidate = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('.tree-row.dir[data-tree-path]')
      const candidatePath = candidate?.dataset.treePath ?? null

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

  if (node.isDir) {
    return (
      <li>
        <div
          ref={nodeRef}
          className={`tree-row dir${isRevealed ? ' reveal-flash' : ''}${isDragging ? ' dragging' : ''}`}
          style={indent}
          data-tree-path={node.path}
          aria-grabbed={isDragging}
          aria-expanded={expanded}
          aria-busy={loading}
          onPointerDown={handlePointerDown}
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
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            depth={depth + 1}
          />
        )}
        {expanded && children?.length === 0 && !loading && (
          <div className="tree-empty-row" style={{ paddingLeft: `${(depth + 1) * 14 + 27}px` }}>
            {t('空文件夹')}
          </div>
        )}
      </li>
    )
  }

  return (
    <li>
      <div
        ref={nodeRef}
        className={`tree-row file${node.openable ? '' : ' unsupported'}${isActive ? ' active' : ''}${isRevealed ? ' reveal-flash' : ''}${isDragging ? ' dragging' : ''}`}
        style={indent}
        data-tree-path={node.path}
        aria-grabbed={isDragging}
        aria-disabled={!node.openable}
        title={node.openable ? node.name : t('此文件类型不能在编辑器中打开')}
        onPointerDown={handlePointerDown}
        onClick={() => {
          if (!consumeSuppressedClick() && node.openable) onOpenFile(node.path, node.name)
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
