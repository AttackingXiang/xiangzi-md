import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Folder,
} from 'lucide-react'
import { useCallback, type RefObject } from 'react'
import FileTree from './FileTree'
import type { FileNode, Folder as FolderType } from '../types'
import { t } from '../lib/i18n'
import { baseName } from '../lib/path'

interface Props {
  folder: FolderType | null
  activePath: string | null
  favorites: string[]
  favoritesCollapsed: boolean
  favoriteLabels: Record<string, string>
  recentFiles: string[]
  /** 当前需要在文件树中定位的绝对路径；null 时不触发 */
  revealPath: string | null
  revealRequestId: number | null
  onRevealComplete: (requestId: number) => void
  /** 是否在文件树中隐藏与 attachmentFolder 同名的目录 */
  hideAttachmentFolders: boolean
  attachmentFolder: string
  onOpenFolder: () => void
  onOpenFolderPath: (root: string) => void
  onOpenFile: (path: string, name?: string) => void
  onOpenSettings: () => void
  onOpenSearch: () => void
  onToggleFavorite: (path: string) => void
  onFavoritesCollapsedChange: (collapsed: boolean) => void
  onFavoriteContext: (path: string, x: number, y: number) => void
  onRefresh: () => void
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onRootContext: (x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  reloadKey: number
  /** Ref to the Set of expanded folder paths — persists across tree remounts. */
  expandedPathsRef: RefObject<Set<string>>
  canUndo: boolean
  onUndo: () => void
  style?: React.CSSProperties
}

export default function Sidebar({
  folder,
  activePath,
  favorites,
  favoritesCollapsed,
  favoriteLabels,
  revealPath,
  revealRequestId,
  onRevealComplete,
  hideAttachmentFolders,
  attachmentFolder,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFile,
  onOpenSettings,
  onOpenSearch,
  onToggleFavorite,
  onFavoritesCollapsedChange,
  onFavoriteContext,
  onRefresh,
  onNodeContext,
  onRootContext,
  onMove,
  reloadKey,
  expandedPathsRef,
  canUndo,
  onUndo,
  style,
}: Props): JSX.Element {
  const isFav = folder ? favorites.includes(folder.root) : false
  const hideFolderNames = hideAttachmentFolders && attachmentFolder ? [attachmentFolder] : []

  const handleToggleExpanded = useCallback((path: string, expanded: boolean) => {
    if (expanded) expandedPathsRef.current?.add(path)
    else expandedPathsRef.current?.delete(path)
  }, [expandedPathsRef])

  return (
    <aside className="sidebar" style={style}>
      <div className="sidebar-header">
        <span
          className="sidebar-title"
          title={folder ? folder.root : undefined}
          onContextMenu={
            folder
              ? (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRootContext(event.clientX, event.clientY)
                }
              : undefined
          }
        >
          {folder ? folder.name : t('资源管理器')}
        </span>
        <div className="sidebar-actions">
          {folder && canUndo && (
            <button
              className="icon-btn sm"
              title={t('撤销上次操作')}
              onClick={onUndo}
            >
              <RotateCcw size={15} />
            </button>
          )}
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
          <button className="icon-btn sm" title={t('打开文件夹')} onClick={() => onOpenFolder()}>
            <FolderOpen size={15} />
          </button>
          <button className="icon-btn sm" title={t('设置')} onClick={onOpenSettings}>
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      {favorites.length > 0 && (
        <div className="sidebar-section">
          <button
            className="section-label favorite-section-toggle"
            title={t(favoritesCollapsed ? '展开收藏目录' : '收起收藏目录')}
            aria-expanded={!favoritesCollapsed}
            onClick={() => onFavoritesCollapsedChange(!favoritesCollapsed)}
          >
            {favoritesCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <span>{t('收藏目录')}</span>
          </button>
          {!favoritesCollapsed &&
            favorites.map((fav) => (
              <div
                key={fav}
                className={`fav-row${folder?.root === fav ? ' active' : ''}`}
                title={fav}
                onClick={() => onOpenFolderPath(fav)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onFavoriteContext(fav, event.clientX, event.clientY)
                }}
              >
                <Folder size={14} />
                <span className="fav-name">{favoriteLabels[fav]?.trim() || baseName(fav)}</span>
              </div>
            ))}
        </div>
      )}

      <div
        className="sidebar-body"
        onContextMenu={(e) => {
          const target = e.target
          if (folder && target instanceof Element && !target.closest('.tree-row')) {
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
            revealRequestId={revealRequestId}
            onRevealComplete={onRevealComplete}
            hideFolderNames={hideFolderNames}
            onOpenFile={onOpenFile}
            onNodeContext={onNodeContext}
            onMove={onMove}
            rootPath={folder.root}
            depth={0}
            expandedPaths={expandedPathsRef.current ?? new Set()}
            onToggleExpanded={handleToggleExpanded}
          />
        ) : (
          <div className="sidebar-empty">
            <p>{t('尚未打开文件夹')}</p>
            <button className="primary-btn" onClick={() => onOpenFolder()}>
              {t('打开文件夹')}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
