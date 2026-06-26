import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import type { FileNode } from '../types'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  /** 当设置后，文件树自动展开祖先目录并滚动到目标文件 */
  revealPath: string | null
  /** 需要从文件树中隐藏的目录名（完整名称匹配，所有层级） */
  hideFolderNames: string[]
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  depth: number
}

export default function FileTree({
  nodes,
  activePath,
  revealPath,
  hideFolderNames,
  onOpenFile,
  onNodeContext,
  depth
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
          depth={depth}
        />
      ))}
    </ul>
  )
}

function TreeNode({
  node,
  activePath,
  revealPath,
  hideFolderNames,
  onOpenFile,
  onNodeContext,
  depth
}: {
  node: FileNode
  activePath: string | null
  revealPath: string | null
  hideFolderNames: string[]
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  depth: number
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null)
  const [loading, setLoading] = useState(false)
  const nodeRef = useRef<HTMLDivElement>(null)

  const isActive = activePath === node.path
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  // Is this dir an ancestor of the reveal target?
  const isAncestor =
    node.isDir &&
    revealPath !== null &&
    (revealPath.startsWith(node.path + '/') || revealPath.startsWith(node.path + '\\'))

  // Is this node the reveal target?
  const isRevealed = !node.isDir && revealPath === node.path

  // Auto-expand ancestor directories when a reveal is requested
  useEffect(() => {
    if (!isAncestor) return
    setExpanded(true)
    if (children === null && !loading) {
      setLoading(true)
      window.api
        .readDir(node.path)
        .then((kids) => { setChildren(kids); setLoading(false) })
        .catch(() => { setChildren([]); setLoading(false) })
    }
    // Only re-run when ancestor relationship changes, not on every children/loading update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAncestor])

  // Scroll revealed file into view
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
        const kids = await window.api.readDir(node.path)
        setChildren(kids)
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }

  if (node.isDir) {
    return (
      <li>
        <div
          className="tree-row dir"
          style={indent}
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
}
