import FileTree from './FileTree'
import type { Folder } from '../types'

interface Props {
  folder: Folder | null
  activePath: string | null
  onOpenFolder: () => void
  onOpenFile: (path: string, name: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
}

export default function Sidebar({
  folder,
  activePath,
  onOpenFolder,
  onOpenFile,
  onOpenSettings,
  onRefresh
}: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{folder ? folder.name : '资源管理器'}</span>
        <div className="sidebar-actions">
          {folder && (
            <button className="icon-btn" title="刷新" onClick={onRefresh}>
              ⟳
            </button>
          )}
          <button className="icon-btn" title="打开文件夹" onClick={onOpenFolder}>
            📂
          </button>
          <button className="icon-btn" title="设置" onClick={onOpenSettings}>
            ⚙
          </button>
        </div>
      </div>

      <div className="sidebar-body">
        {folder ? (
          <FileTree nodes={folder.tree} activePath={activePath} onOpenFile={onOpenFile} depth={0} />
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
