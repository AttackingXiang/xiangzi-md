import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { desktop } from '../platform'
import type { FileNode } from '../types'
import { dirName } from '../lib/path'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  /** 当设置后，文件树自动展开祖先目录并滚动到目标文件 */
  revealPath: string | null
  /** 需要从文件树中隐藏的目录名（完整名称匹配，所有层级） */
  hideFolderNames: string[]
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  depth: number
}

export default function FileTree({
  nodes,
  activePath,
  revealPath,
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
  hideFolderNames,
  onOpenFile,
  onNodeContext,
  onMove,
  depth,
}: {
  node: FileNode
  activePath: string | null
  revealPath: string | null
  hideFolderNames: string[]
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  depth: number
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null)
  const [loading, setLoading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const nodeRef = useRef<HTMLDivElement>(null)

  const isActive = activePath === node.path
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  const isAncestor =
    node.isDir &&
    revealPath !== null &&
    (revealPath.startsWith(node.path + '/') || revealPath.startsWith(node.path + '\\'))

  const isRevealed = !node.isDir && revealPath === node.path

  useEffect(() => {
    if (!isAncestor) return
    setExpanded(true)
    if (children === null && !loading) {
      setLoading(true)
      desktop
        .readDir(node.path)
        .then((kids) => {
          setChildren(kids)
          setLoading(false)
        })
        .catch(() => {
          setChildren([])
          setLoading(false)
        })
    }
  }, [isAncestor])

  useEffect(() => {
    if (!isRevealed || !nodeRef.current) return
    nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [isRevealed])

  const toggle = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    if (next && children === null && !loading) {
      setLoading(true)
      try {
        const kids = await desktop.readDir(node.path)
        setChildren(kids)
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }

  // ── Drag handlers ────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent): void => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(
      'application/x-filetree',
      JSON.stringify({ path: node.path, isDir: node.isDir }),
    )
  }

  // Only folders accept drops
  const handleDragOver = (e: React.DragEvent): void => {
    if (!node.isDir) return
    if (!e.dataTransfer.types.includes('application/x-filetree')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (!node.isDir) return

    const raw = e.dataTransfer.getData('application/x-filetree')
    if (!raw) return
    const { path: srcPath, isDir: srcIsDir } = JSON.parse(raw) as { path: string; isDir: boolean }

    // No-op: dropping into its own current parent
    if (dirName(srcPath) === node.path) return

    // Cycle guard: can't drop a folder into its own descendant
    if (
      srcIsDir &&
      (node.path === srcPath ||
        node.path.startsWith(srcPath + '/') ||
        node.path.startsWith(srcPath + '\\'))
    )
      return

    // Expand the target folder after drop so the moved item is visible
    setExpanded(true)
    onMove(srcPath, node.path)
  }

  if (node.isDir) {
    return (
      <li>
        <div
          className={`tree-row dir${isDragOver ? ' drag-over' : ''}`}
          style={indent}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={toggle}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onNodeContext(node, e.clientX, e.clientY)
          }}
        >
          <span className="tree-caret">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Folder size={15} className="tree-icon" />
          <span className="tree-name">{node.name}</span>
        </div>
        {expanded && children && children.length > 0 && (
          <FileTree
            nodes={children}
            activePath={activePath}
            revealPath={revealPath}
            hideFolderNames={hideFolderNames}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            depth={depth + 1}
          />
        )}
      </li>
    )
  }

  return (
    <li>
      <div
        ref={nodeRef}
        className={`tree-row file${isActive ? ' active' : ''}${isRevealed ? ' reveal-flash' : ''}`}
        style={indent}
        draggable
        onDragStart={handleDragStart}
        onClick={() => onOpenFile(node.path, node.name)}
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
