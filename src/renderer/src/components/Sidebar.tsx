import { FolderOpen, RefreshCw, Search, Settings as SettingsIcon, Star, Folder } from 'lucide-react'
import FileTree from './FileTree'
import type { FileNode, Folder as FolderType } from '../types'

interface Props {
  folder: FolderType | null
  activePath: string | null
  favorites: string[]
  recentFiles: string[]
  onOpenFolder: () => void
  onOpenFolderPath: (root: string) => void
  onOpenFile: (path: string, name?: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleFavorite: (path: string) => void
  onRefresh: () => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onRootContext: (x: number, y: number) => void
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

export default function Sidebar({
  folder,
  activePath,
  favorites,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFile,
  onOpenSettings,
  onOpenSearch,
  onToggleFavorite,
  onRefresh,
  onNodeContext,
  onRootContext
}: Props): JSX.Element {
  const isFav = folder ? favorites.includes(folder.root) : false

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{folder ? folder.name : '资源管理器'}</span>
        <div className="sidebar-actions">
          {folder && (
            <button
              className={`icon-btn sm${isFav ? ' active' : ''}`}
              title={isFav ? '取消收藏' : '收藏此目录'}
              onClick={() => onToggleFavorite(folder.root)}
            >
              <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          )}
          {folder && (
            <button className="icon-btn sm" title="刷新" onClick={onRefresh}>
              <RefreshCw size={15} />
            </button>
          )}
          {folder && (
            <button className="icon-btn sm" title="在文件夹中搜索" onClick={onOpenSearch}>
              <Search size={15} />
            </button>
          )}
          <button className="icon-btn sm" title="打开文件夹" onClick={onOpenFolder}>
            <FolderOpen size={15} />
          </button>
          <button className="icon-btn sm" title="设置" onClick={onOpenSettings}>
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="sidebar-section">
          <div className="section-label">收藏目录</div>
          {favorites.map((fav) => (
            <div
              key={fav}
              className={`fav-row${folder?.root === fav ? ' active' : ''}`}
              title={fav}
              onClick={() => onOpenFolderPath(fav)}
            >
              <Folder size={14} />
              <span className="fav-name">{baseName(fav)}</span>
            </div>
          ))}
        </div>
      )}

      <div
        className="sidebar-body"
        onContextMenu={(e) => {
          // 仅当点击在空白处（非节点）时弹出根目录菜单
          if (folder && e.target === e.currentTarget) {
            e.preventDefault()
            onRootContext(e.clientX, e.clientY)
          }
        }}
      >
        {folder ? (
          <FileTree
            nodes={folder.tree}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            depth={0}
          />
        ) : (
          <div className="sidebar-empty">
            <p>尚未打开文件夹</p>
            <button className="primary-btn" onClick={onOpenFolder}>
              打开文件夹
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
