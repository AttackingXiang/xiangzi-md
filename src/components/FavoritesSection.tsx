import { ChevronDown, ChevronRight, FileText, Folder, X } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../lib/i18n'
import { baseName } from '../lib/path'
import { documentPathKey, sameDocumentPath } from '../lib/pathIdentity'
import { reorderFavoritePaths } from '../lib/favorites'

interface Props {
  favorites: string[]
  /** 收藏项里哪些是文件（其余按文件夹处理）。 */
  favoriteFiles: string[]
  favoriteLabels: Record<string, string>
  collapsed: boolean
  /** 当前工作区根目录，用来高亮对应的文件夹收藏。 */
  folderRoot: string | null
  /** 当前正在编辑的文档，用来高亮对应的文件收藏。 */
  activePath: string | null
  onCollapsedChange: (collapsed: boolean) => void
  onOpenFile: (path: string, name?: string) => void
  onOpenFolderPath: (root: string) => void
  onToggleFavorite: (path: string) => void
  onReorder: (favorites: string[]) => void
  onContext: (path: string, x: number, y: number) => void
}

/**
 * 文件树上方的收藏区。
 *
 * 文件夹和文件分两组：点文件夹收藏会切换整个工作区根目录，点文件只是打开一篇
 * 文档——这两件事的份量差得远，只靠一个图标区分不够。组内可拖拽调顺序，顺序就是
 * `settings.favorites` 数组本身。
 */
export default function FavoritesSection({
  favorites,
  favoriteFiles,
  favoriteLabels,
  collapsed,
  folderRoot,
  activePath,
  onCollapsedChange,
  onOpenFile,
  onOpenFolderPath,
  onToggleFavorite,
  onReorder,
  onContext,
}: Props): JSX.Element | null {
  const [dropPath, setDropPath] = useState<string | null>(null)
  // 拖完后短暂压制点击，免得"拖动结束"被当成"打开这一项"（跟标签树一致）。
  const suppressClickRef = useRef(false)

  // Set 而不是每行 favoriteFiles.some(...)：成员判定原先在 sort 比较器里，
  // 每次比较调用两次，等于每渲染一次就跑 O(n log n · m) 次路径规范化。
  const fileKeys = new Set(favoriteFiles.map(documentPathKey))
  const isFile = (path: string): boolean => fileKeys.has(documentPathKey(path))
  if (favorites.length === 0) return null

  const folderFavorites = favorites.filter((path) => !isFile(path))
  const fileFavorites = favorites.filter(isFile)
  // 只有一组时分组标题没有区分作用，白占一行——窄栏里这一行不便宜。
  const showGroupLabels = folderFavorites.length > 0 && fileFavorites.length > 0

  /** 指针拖拽而不是 HTML5 draggable：WKWebView 里后者不可靠，大纲/文件树/标签树
   * 都走的这套。只允许在同一组内落位——跨组拖不会改变可见顺序。 */
  const startDrag = (event: ReactPointerEvent, dragPath: string): void => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    const targetAt = (x: number, y: number): string | null => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.fav-row[data-fav-path]')
      const path = row?.dataset.favPath ?? null
      if (path === null || path === dragPath) return null
      return isFile(path) === isFile(dragPath) ? path : null
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.classList.remove('fav-dragging')
      setDropPath(null)
    }
    const onMove = (moveEvent: PointerEvent): void => {
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return
        dragging = true
        document.body.classList.add('fav-dragging')
        window.getSelection()?.removeAllRanges()
      }
      moveEvent.preventDefault()
      setDropPath(targetAt(moveEvent.clientX, moveEvent.clientY))
    }
    const onUp = (upEvent: PointerEvent): void => {
      const wasDragging = dragging
      const target = targetAt(upEvent.clientX, upEvent.clientY)
      cleanup()
      if (!wasDragging) return
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      if (target) onReorder(reorderFavoritePaths(favorites, dragPath, target))
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }

  const row = (path: string): JSX.Element => {
    const file = isFile(path)
    const active = file
      ? activePath !== null && sameDocumentPath(path, activePath)
      : folderRoot !== null && sameDocumentPath(folderRoot, path)
    const label = favoriteLabels[path]?.trim() || baseName(path)
    return (
      <div
        key={path}
        className={`fav-row${active ? ' active' : ''}${dropPath === path ? ' drop-target' : ''}`}
        data-fav-path={path}
        onPointerDown={(event) => startDrag(event, path)}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onContext(path, event.clientX, event.clientY)
        }}
      >
        <button
          type="button"
          className="fav-open"
          // 文件夹收藏换的是整个工作区，标题里说清楚，别只靠图标。
          title={file ? path : `${t('切换到此工作区')}\n${path}`}
          onClick={() => {
            if (suppressClickRef.current) return
            if (file) onOpenFile(path, baseName(path))
            else onOpenFolderPath(path)
          }}
        >
          {file ? <FileText size={14} /> : <Folder size={14} />}
          <span className="fav-name">{label}</span>
        </button>
        <button
          type="button"
          className="fav-remove"
          title={t('取消收藏')}
          aria-label={`${t('取消收藏')}：${label}`}
          onClick={() => onToggleFavorite(path)}
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar-section">
      <button
        className="section-label favorite-section-toggle"
        title={t(collapsed ? '展开收藏目录' : '收起收藏目录')}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>{t('收藏')}</span>
        <small className="fav-count">{favorites.length}</small>
      </button>
      {!collapsed && (
        <>
          {showGroupLabels && <div className="fav-group-label">{t('文件夹')}</div>}
          {folderFavorites.map(row)}
          {showGroupLabels && <div className="fav-group-label">{t('文档')}</div>}
          {fileFavorites.map(row)}
        </>
      )}
    </div>
  )
}
