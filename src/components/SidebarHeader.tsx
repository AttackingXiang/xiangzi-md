import {
  ArrowDownAZ,
  Check,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Tags,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FileTreeSort, Folder as FolderType } from '../types'
import { FILE_TREE_SORT_OPTIONS } from '../lib/fileTreeSort'
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
  showSidebarUndoButton: boolean
  showSidebarFavoriteButton: boolean
  showSidebarRefreshButton: boolean
  showSidebarSearchButton: boolean
  showSidebarTagsButton: boolean
  showSidebarSortButton: boolean
  /** 文件树快捷排序；标签面板复用头部时不传入。 */
  fileTreeSort?: FileTreeSort
  onFileTreeSortChange?: (sort: FileTreeSort) => void
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
  showSidebarUndoButton,
  showSidebarFavoriteButton,
  showSidebarRefreshButton,
  showSidebarSearchButton,
  showSidebarTagsButton,
  showSidebarSortButton,
  fileTreeSort,
  onFileTreeSortChange,
}: Props): JSX.Element {
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sortControlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sortMenuOpen) return undefined
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!sortControlRef.current?.contains(event.target as Node)) setSortMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSortMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sortMenuOpen])

  const sortOptions = FILE_TREE_SORT_OPTIONS.map((option) => ({
    ...option,
    label: t(option.labelZh),
  }))
  const currentSortLabel =
    sortOptions.find((option) => option.value === fileTreeSort)?.label ?? t('名称（A→Z）')

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
        {folder && canUndo && showSidebarUndoButton && (
          <button className="icon-btn sm" title={t('撤销上次操作')} onClick={onUndo}>
            <RotateCcw size={15} />
          </button>
        )}
        {folder && showSidebarFavoriteButton && (
          <button
            className={`icon-btn sm${isFav ? ' active' : ''}`}
            title={isFav ? t('取消收藏') : t('收藏此目录')}
            onClick={() => onToggleFavorite(folder.root)}
          >
            <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
          </button>
        )}
        {folder && showSidebarRefreshButton && (
          <button className="icon-btn sm" title={t('刷新')} onClick={onRefresh}>
            <RefreshCw size={15} />
          </button>
        )}
        {folder && showSidebarSearchButton && (
          <button className="icon-btn sm" title={t('在文件夹中搜索')} onClick={onOpenSearch}>
            <Search size={15} />
          </button>
        )}
        {folder && showSidebarSortButton && fileTreeSort && onFileTreeSortChange && (
          <div className="sidebar-sort-control" ref={sortControlRef}>
            <button
              className={`icon-btn sm${sortMenuOpen ? ' active' : ''}`}
              title={`${t('文件树排序')}：${currentSortLabel}`}
              aria-label={`${t('文件树排序')}：${currentSortLabel}`}
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              onClick={() => setSortMenuOpen((open) => !open)}
            >
              <ArrowDownAZ size={15} />
            </button>
            {sortMenuOpen && (
              <div className="sidebar-sort-menu" role="menu" aria-label={t('文件树排序')}>
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`sidebar-sort-option${option.value === fileTreeSort ? ' active' : ''}`}
                    role="menuitemradio"
                    aria-checked={option.value === fileTreeSort}
                    onClick={() => {
                      onFileTreeSortChange(option.value)
                      setSortMenuOpen(false)
                    }}
                  >
                    <span>{option.label}</span>
                    {option.value === fileTreeSort && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {folder && showSidebarTagsButton && (
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
