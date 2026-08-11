import { memo, Suspense, useCallback, useRef, useState, type RefObject } from 'react'
import FavoritesSection from './FavoritesSection'
import FileTree from './FileTree'
import { FocusedPathContext } from './fileTreeFocusContext'
import HoverScrollbars from './LazyHoverScrollbars'
import type { FileNode, Folder as FolderType } from '../types'
import type { SortContext } from '../lib/fileTreeSort'
import { t } from '../lib/i18n'

interface Props {
  folder: FolderType | null
  activePath: string | null
  favorites: string[]
  favoriteFiles: string[]
  favoritesCollapsed: boolean
  favoriteLabels: Record<string, string>
  /** 文件树排序方式 + 置顶集合 + 最近打开排名 */
  sortContext: SortContext
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
  onFavoritesCollapsedChange: (collapsed: boolean) => void
  onFavoriteContext: (path: string, x: number, y: number) => void
  onToggleFavorite: (path: string) => void
  onReorderFavorites: (favorites: string[]) => void
  onRefresh: () => void
  treeError?: string | null
  onNodeContext: (node: FileNode, x: number, y: number) => void
  onRootContext: (x: number, y: number) => void
  onMove: (sourcePath: string, targetDirPath: string) => Promise<void>
  reloadKey: number
  /** Ref to the Set of expanded folder paths — persists across tree remounts. */
  expandedPathsRef: RefObject<Set<string>>
}

/** 左栏「文件」模式的主体：收藏区 + 文件树。顶部的文件夹名那一行（SidebarHeader）
 * 和模式切换器由 App 渲染，三种模式共用，所以不在这里。 */
const Sidebar = memo(function Sidebar({
  folder,
  activePath,
  favorites,
  favoriteFiles,
  favoritesCollapsed,
  favoriteLabels,
  sortContext,
  revealPath,
  revealRequestId,
  onRevealComplete,
  hideAttachmentFolders,
  attachmentFolder,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFile,
  onFavoritesCollapsedChange,
  onFavoriteContext,
  onToggleFavorite,
  onReorderFavorites,
  onRefresh,
  treeError = null,
  onNodeContext,
  onRootContext,
  onMove,
  reloadKey,
  expandedPathsRef,
}: Props): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const hideFolderNames = hideAttachmentFolders && attachmentFolder ? [attachmentFolder] : []

  // Roving-tabindex target for the file tree's keyboard navigation. Lifted here (rather than
  // into FileTree itself) because FileTree recurses into itself for nested directories — a
  // single shared "which row is the Tab stop" state can't live inside a component that is its
  // own grandparent.
  const [focusedPath, setFocusedPath] = useState<string | null>(null)

  const handleToggleExpanded = useCallback(
    (path: string, expanded: boolean) => {
      if (expanded) expandedPathsRef.current?.add(path)
      else expandedPathsRef.current?.delete(path)
    },
    [expandedPathsRef],
  )

  return (
    <div className="sidebar-panel">
      <FavoritesSection
        favorites={favorites}
        favoriteFiles={favoriteFiles}
        favoriteLabels={favoriteLabels}
        collapsed={favoritesCollapsed}
        folderRoot={folder?.root ?? null}
        activePath={activePath}
        onCollapsedChange={onFavoritesCollapsedChange}
        onOpenFile={onOpenFile}
        onOpenFolderPath={onOpenFolderPath}
        onToggleFavorite={onToggleFavorite}
        onReorder={onReorderFavorites}
        onContext={onFavoriteContext}
      />

      <div className="scrollbar-host sidebar-scrollbar-host">
        <div
          className="sidebar-body"
          ref={bodyRef}
          onContextMenu={(e) => {
            const target = e.target
            if (folder && target instanceof Element && !target.closest('.tree-row')) {
              e.preventDefault()
              onRootContext(e.clientX, e.clientY)
            }
          }}
        >
          {treeError && (
            <div className="tree-error-banner" role="alert">
              <span>{treeError}</span>
              <button type="button" onClick={onRefresh}>
                {t('重试')}
              </button>
            </div>
          )}
          {folder ? (
            // focusedPath 走 Context 而不是 prop：见 FileTree.tsx 里 FocusedPathContext 的注释，
            // 这样按方向键只会重渲染实际翻转 tab-stop 状态的那一两行，不会因为逐层转发 prop
            // 而牵连路径上所有已展开目录的 TreeNode。
            <FocusedPathContext.Provider value={focusedPath}>
              <FileTree
                key={reloadKey}
                nodes={folder.tree}
                activePath={activePath}
                revealPath={revealPath}
                revealRequestId={revealRequestId}
                onRevealComplete={onRevealComplete}
                hideFolderNames={hideFolderNames}
                sortContext={sortContext}
                onOpenFile={onOpenFile}
                onNodeContext={onNodeContext}
                onMove={onMove}
                rootPath={folder.root}
                depth={0}
                expandedPaths={expandedPathsRef.current ?? new Set()}
                onToggleExpanded={handleToggleExpanded}
                onFocusPath={setFocusedPath}
              />
            </FocusedPathContext.Provider>
          ) : (
            <div className="sidebar-empty">
              <p>{t('尚未打开文件夹')}</p>
              <button className="primary-btn" onClick={() => onOpenFolder()}>
                {t('打开文件夹')}
              </button>
            </div>
          )}
        </div>
        <Suspense fallback={null}>
          <HoverScrollbars targetRef={bodyRef} />
        </Suspense>
      </div>
    </div>
  )
})

export default Sidebar
