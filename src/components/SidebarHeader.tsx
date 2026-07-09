import {
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Tags,
} from 'lucide-react'
import type { Folder as FolderType } from '../types'
import { t } from '../lib/i18n'

interface Props {
  folder: FolderType | null
  isFav: boolean
  canUndo: boolean
  /** 是否显示"打开文件夹"按钮（默认隐藏，见控件设置） */
  showOpenFolderButton: boolean
  /** 是否显示"设置"按钮（默认隐藏，见控件设置） */
  showSettingsButton: boolean
  onUndo: () => void
  onToggleFavorite: (root: string) => void
  onRefresh: () => void
  onOpenSearch: () => void
  onShowTags: () => void
  onOpenFolder: () => void
  onOpenSettings: () => void
  onRootContext: (x: number, y: number) => void
}

/** 侧边栏顶部固定头部：当前文件夹名 + 操作按钮。文件树 / 标签面板都复用它，
 * 这样切到标签视图时"当前打开的文件夹"这一行不会消失。 */
export default function SidebarHeader({
  folder,
  isFav,
  canUndo,
  showOpenFolderButton,
  showSettingsButton,
  onUndo,
  onToggleFavorite,
  onRefresh,
  onOpenSearch,
  onShowTags,
  onOpenFolder,
  onOpenSettings,
  onRootContext,
}: Props): JSX.Element {
  return (
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
          <button className="icon-btn sm" title={t('撤销上次操作')} onClick={onUndo}>
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
        {folder && (
          <button className="icon-btn sm" title={t('标签治理')} onClick={onShowTags}>
            <Tags size={15} />
          </button>
        )}
        {showOpenFolderButton && (
          <button className="icon-btn sm" title={t('打开文件夹')} onClick={() => onOpenFolder()}>
            <FolderOpen size={15} />
          </button>
        )}
        {showSettingsButton && (
          <button className="icon-btn sm" title={t('设置')} onClick={onOpenSettings}>
            <SettingsIcon size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
