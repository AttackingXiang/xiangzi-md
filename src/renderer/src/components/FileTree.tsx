import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import type { FileNode } from '../types'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  depth: number
}

export default function FileTree({
  nodes,
  activePath,
  onOpenFile,
  onNodeContext,
  depth
}: Props): JSX.Element {
  return (
    <ul className="file-tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          activePath={activePath}
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
  onOpenFile,
  onNodeContext,
  depth
}: {
  node: FileNode
  activePath: string | null
  onOpenFile: (path: string, name?: string) => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  depth: number
}): JSX.Element {
  // 默认全部折叠；子项懒加载
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null)
  const [loading, setLoading] = useState(false)
  const isActive = activePath === node.path
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  const toggle = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    // 首次展开时按需加载子目录
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
        className={`tree-row file${isActive ? ' active' : ''}`}
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
