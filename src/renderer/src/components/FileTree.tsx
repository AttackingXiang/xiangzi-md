import { useState } from 'react'
import type { FileNode } from '../types'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  onOpenFile: (path: string, name: string) => void
  depth: number
}

export default function FileTree({ nodes, activePath, onOpenFile, depth }: Props): JSX.Element {
  return (
    <ul className="file-tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          activePath={activePath}
          onOpenFile={onOpenFile}
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
  depth
}: {
  node: FileNode
  activePath: string | null
  onOpenFile: (path: string, name: string) => void
  depth: number
}): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1)
  const isActive = activePath === node.path
  const indent = { paddingLeft: `${depth * 14 + 8}px` }

  if (node.isDir) {
    return (
      <li>
        <div className="tree-row dir" style={indent} onClick={() => setExpanded((v) => !v)}>
          <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
          <span className="tree-icon">📁</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {expanded && node.children && node.children.length > 0 && (
          <FileTree
            nodes={node.children}
            activePath={activePath}
            onOpenFile={onOpenFile}
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
      >
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
      </div>
    </li>
  )
}
