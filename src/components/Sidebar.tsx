import { FolderOpen, RefreshCw, Search, Settings as SettingsIcon, Star, Folder } from 'lucide-react'
import FileTree from './FileTree'
import type { FileNode, Folder as FolderType } from '../types'
import { t } from '../lib/i18n'
import { baseName } from '../lib/path'

interface Props {
  folder: FolderType | null
  activePath: string | null
  favorites: string[]
  recentFiles: string[]
  /** 当前需要在文件树中定位的绝对路径；null 时不触发 */
  revealPath: string | null
  /** 是否在文件树中隐藏与 attachmentFolder 同名的目录 */
  hideAttachmentFolders: boolean
  attachmentFolder: string
  onOpenFolder: () => void
  onOpenFolderPath: (root: string) => void
  onOpenFile: (path: string, name?: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleFavorite: (path: string) => void
  onRefresh: () => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onRootContext: (x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  reloadKey: number
  style?: React.CSSProperties
}

export default function Sidebar({
  folder,
  activePath,
  favorites,
  revealPath,
  hideAttachmentFolders,
  attachmentFolder,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFile,
  onOpenSettings,
  onOpenSearch,
  onToggleFavorite,
  onRefresh,
  onNodeContext,
  onRootContext,
  onMove,
  reloadKey,
  style,
}: Props): JSX.Element {
  const isFav = folder ? favorites.includes(folder.root) : false
  const hideFolderNames = hideAttachmentFolders && attachmentFolder ? [attachmentFolder] : []

  return (
    <aside className="sidebar" style={style}>
      <div className="sidebar-header">
        <span className="sidebar-title">{folder ? folder.name : t('资源管理器')}</span>
        <div className="sidebar-actions">
          {folder && (
            <button
              className={`icon-btn sm${isFav ? ' active' : ''}`}
              title={isFav ? t('取消收藏') : t('收藏此目录')}
              onClick={() => onToggleFavorite(folder.root)}
            >
              <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          )}
          {folder && (
            <button className="icon-btn sm" title={t('刷新')} onClick={onRefresh}>
              <RefreshCw size={15} />
            </button>
          )}
          {folder && (
            <button className="icon-btn sm" title={t('在文件夹中搜索')} onClick={onOpenSearch}>
              <Search size={15} />
            </button>
          )}
          <button className="icon-btn sm" title={t('打开文件夹')} onClick={onOpenFolder}>
            <FolderOpen size={15} />
          </button>
          <button className="icon-btn sm" title={t('设置')} onClick={onOpenSettings}>
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="sidebar-section">
          <div className="section-label">{t('收藏目录')}</div>
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
          if (folder && e.target === e.currentTarget) {
            e.preventDefault()
            onRootContext(e.clientX, e.clientY)
          }
        }}
      >
        {folder ? (
          <FileTree
            key={reloadKey}
            nodes={folder.tree}
            activePath={activePath}
            revealPath={revealPath}
            hideFolderNames={hideFolderNames}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            depth={0}
          />
        ) : (
          <div className="sidebar-empty">
            <p>{t('尚未打开文件夹')}</p>
            <button className="primary-btn" onClick={onOpenFolder}>
              {t('打开文件夹')}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
