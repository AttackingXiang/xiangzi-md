import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { getLang, t } from '../lib/i18n'
import { revealLocationKey } from '../lib/platform'
import { baseName, dirName } from '../lib/path'
import { replaceMovedPath } from '../lib/treeDrag'
import { removeWorkspacePath } from '../lib/workspaceRemoval'
import type { FileNode, Folder, Tab } from '../types'
import type { MenuItem } from '../components/ContextMenu'

export type UndoItem =
  | { type: 'rename'; fromPath: string; toPath: string; toName: string }
  | { type: 'move'; fromPath: string; toDir: string; toName: string }
  // 通用"恢复"条目：由调用方给出撤销时要执行的动作（如把文档标签恢复到改动前）。
  // 让不涉及文件树的操作也能复用同一套撤销栈 / 撤销按钮 / Cmd+Z。
  | { type: 'restore'; run: () => Promise<void> | void }

interface Deps {
  folder: Folder | null
  setFolder: (updater: (prev: Folder | null) => Folder | null) => void
  openPath: (path: string, name?: string) => Promise<void>
  confirmCloseTabs: (ids: readonly string[]) => Promise<boolean>
  closeTabsWithoutPrompt: (ids: readonly string[]) => void
  tabs: Tab[]
  setTabs: Dispatch<SetStateAction<Tab[]>>
  openParentFolder: (root: string) => void
  chooseFolderFrom: (root: string) => void
  /** 当前置顶的文件夹路径集合，用于在右键菜单显示「置顶 / 取消置顶」。 */
  pinnedFolders: string[]
  togglePinnedFolder: (path: string) => void
  favorites: string[]
  toggleFavorite: (path: string, isFile?: boolean) => void
  setCtxMenu: (menu: { x: number; y: number; items: MenuItem[] } | null) => void
  setInputDialog: (
    dialog: {
      title: string
      initial?: string
      confirmText?: string
      onSubmit: (value: string) => void
    } | null,
  ) => void
}

/**
 * File tree operations: create, rename, delete, right-click menus, tree refresh.
 */
export function useTreeOps({
  folder,
  setFolder,
  openPath,
  confirmCloseTabs,
  closeTabsWithoutPrompt,
  tabs,
  setTabs,
  openParentFolder,
  chooseFolderFrom,
  pinnedFolders,
  togglePinnedFolder,
  favorites,
  toggleFavorite,
  setCtxMenu,
  setInputDialog,
}: Deps) {
  const [treeKey, setTreeKey] = useState(0)

  // Persists expanded folder paths across tree remounts (refresh/rename/move).
  const expandedPathsRef = useRef<Set<string>>(new Set())

  const undoStack = useRef<UndoItem[]>([])
  const [canUndo, setCanUndo] = useState(false)

  const pushUndo = useCallback((item: UndoItem) => {
    undoStack.current.push(item)
    setCanUndo(true)
  }, [])

  /** Update expandedPaths when a path moves (rename or file-system move). */
  const updateExpandedAfterMove = useCallback((oldPath: string, newPath: string): void => {
    const updated = new Set<string>()
    for (const p of expandedPathsRef.current) {
      if (p === oldPath) {
        updated.add(newPath)
      } else if (p.startsWith(oldPath + '/') || p.startsWith(oldPath + '\\')) {
        updated.add(newPath + p.slice(oldPath.length))
      } else {
        updated.add(p)
      }
    }
    expandedPathsRef.current = updated
  }, [])

  const refreshTree = useCallback(async () => {
    const root = folder?.root
    if (!root) return
    try {
      const tree = await desktop.readDir(root)
      setFolder((f) => (f ? { ...f, tree } : f))
      setTreeKey((k) => k + 1)
    } catch {
      /* ignore */
    }
  }, [folder?.root, setFolder])

  // 应用没有文件系统 watcher：外部工具（如 Obsidian）在别处改了同一个目录时，
  // 文件树和标签索引都不会自动更新。折中方案——窗口重新获得焦点时轻量刷新一次：
  // refreshTree 触发 treeKey+1，进而驱动标签索引按 mtime 增量重扫，代价只是一次
  // 目录 walk 加上真正变过的文件的重读，很便宜。展开状态不会因此丢失，因为
  // FileTree 是靠 expandedPathsRef（见上面第 57-58 行的注释）在树重建后恢复展开
  // 路径，而不是依赖树对象引用不变。10 秒节流是为了避免用户在窗口间来回切换时
  // 反复触发刷新。
  const lastFocusRefreshRef = useRef(0)
  useEffect(() => {
    const onFocus = (): void => {
      if (!folder) return
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < 10_000) return
      lastFocusRefreshRef.current = now
      void refreshTree()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [folder, refreshTree])

  const createFileIn = useCallback(
    (dir: string) => {
      setInputDialog({
        title: t('新建文件'),
        initial: getLang() === 'en' ? 'Untitled.md' : '未命名.md',
        confirmText: t('创建'),
        onSubmit: async (name) => {
          const fname = /\.[^.]+$/.test(name) ? name : `${name}.md`
          try {
            const res = await desktop.createFile(dir, fname)
            await refreshTree()
            void openPath(res.path, res.name)
          } catch {
            window.alert(t('创建失败：文件可能已存在'))
          }
        },
      })
    },
    [refreshTree, openPath, setInputDialog],
  )

  const createFolderIn = useCallback(
    (dir: string) => {
      setInputDialog({
        title: t('新建文件夹'),
        initial: getLang() === 'en' ? 'New Folder' : '新建文件夹',
        confirmText: t('创建'),
        onSubmit: async (name) => {
          try {
            await desktop.createDir(dir, name)
            await refreshTree()
          } catch {
            window.alert(t('创建失败：文件夹可能已存在'))
          }
        },
      })
    },
    [refreshTree, setInputDialog],
  )

  const renameNode = useCallback(
    (node: FileNode) => {
      setInputDialog({
        title: t('重命名'),
        initial: node.name,
        confirmText: t('确定'),
        onSubmit: async (name) => {
          try {
            const res = await desktop.rename(node.path, name)
            updateExpandedAfterMove(node.path, res.path)
            setTabs((current) =>
              current.map((tab) => {
                if (!tab.path) return tab
                const nextPath = replaceMovedPath(tab.path, node.path, res.path)
                return nextPath === tab.path
                  ? tab
                  : { ...tab, path: nextPath, name: baseName(nextPath) || res.name }
              }),
            )
            pushUndo({ type: 'rename', fromPath: res.path, toPath: node.path, toName: node.name })
            await refreshTree()
          } catch {
            window.alert(t('重命名失败'))
          }
        },
      })
    },
    [refreshTree, setInputDialog, setTabs, updateExpandedAfterMove, pushUndo],
  )

  const undoLastOp = useCallback(async () => {
    const item = undoStack.current.pop()
    if (!item) return
    setCanUndo(undoStack.current.length > 0)

    try {
      if (item.type === 'restore') {
        await item.run()
        return
      }
      if (item.type === 'rename') {
        const res = await desktop.rename(item.fromPath, item.toName)
        updateExpandedAfterMove(item.fromPath, res.path)
        setTabs((current) =>
          current.map((tab) => {
            if (!tab.path) return tab
            const nextPath = replaceMovedPath(tab.path, item.fromPath, res.path)
            return nextPath === tab.path
              ? tab
              : { ...tab, path: nextPath, name: baseName(nextPath) || res.name }
          }),
        )
      } else if (item.type === 'move') {
        const res = await desktop.moveItem(item.fromPath, item.toDir)
        updateExpandedAfterMove(item.fromPath, res.path)
        setTabs((current) =>
          current.map((tab) => {
            if (!tab.path) return tab
            const nextPath = replaceMovedPath(tab.path, item.fromPath, res.path)
            return nextPath === tab.path
              ? tab
              : { ...tab, path: nextPath, name: baseName(nextPath) || res.name }
          }),
        )
      }
      await refreshTree()
    } catch {
      window.alert(t('撤销失败'))
    }
  }, [refreshTree, setTabs, updateExpandedAfterMove])

  const deleteNode = useCallback(
    async (node: FileNode) => {
      const msg =
        getLang() === 'en'
          ? `Delete "${node.name}"? It will be moved to Trash.`
          : `确定要删除「${node.name}」吗？将移入废纸篓。`
      if (!window.confirm(msg)) return
      try {
        await removeWorkspacePath(node.path, tabs, {
          confirmCloseTabs,
          trash: (path) => desktop.trash(path),
          closeTabsWithoutPrompt,
          refreshTree,
        })
      } catch {
        window.alert(t('删除失败'))
      }
    },
    [tabs, confirmCloseTabs, closeTabsWithoutPrompt, refreshTree],
  )

  // ── Context menus ──────────────────────────────────────────────────────────
  const openNodeContext = useCallback(
    (node: FileNode, x: number, y: number) => {
      const items: MenuItem[] = []
      if (node.isDir) {
        items.push({ label: t('新建文件'), onClick: () => createFileIn(node.path) })
        items.push({ label: t('新建文件夹'), onClick: () => createFolderIn(node.path) })
        items.push({
          label: pinnedFolders.includes(node.path) ? t('取消置顶') : t('置顶'),
          onClick: () => togglePinnedFolder(node.path),
          separatorBefore: true,
        })
      } else if (node.openable) {
        items.push({ label: t('打开'), onClick: () => openPath(node.path, node.name) })
        items.push({
          label: t('用默认应用打开'),
          onClick: () => void desktop.openWithDefault(node.path),
        })
      } else {
        items.push({
          label: t('用默认应用打开'),
          onClick: () => void desktop.openWithDefault(node.path),
        })
      }
      items.push({
        label: favorites.includes(node.path)
          ? t('取消收藏')
          : t(node.isDir ? '收藏文件夹' : '收藏文件'),
        onClick: () => toggleFavorite(node.path, !node.isDir),
        separatorBefore: true,
      })
      items.push({ label: t('重命名'), onClick: () => renameNode(node), separatorBefore: true })
      items.push({ label: t(revealLocationKey()), onClick: () => desktop.reveal(node.path) })
      items.push({
        label: t('删除'),
        onClick: () => deleteNode(node),
        danger: true,
        separatorBefore: true,
      })
      setCtxMenu({ x, y, items })
    },
    [
      createFileIn,
      createFolderIn,
      openPath,
      renameNode,
      deleteNode,
      pinnedFolders,
      togglePinnedFolder,
      favorites,
      toggleFavorite,
      setCtxMenu,
    ],
  )

  const openRootContext = useCallback(
    (x: number, y: number) => {
      if (!folder) return
      const items: MenuItem[] = [
        { label: t('新建文件'), onClick: () => createFileIn(folder.root) },
        { label: t('新建文件夹'), onClick: () => createFolderIn(folder.root) },
      ]
      const parent = dirName(folder.root)
      if (parent && parent !== folder.root) {
        items.push({
          label: t('打开上级文件夹'),
          onClick: () => openParentFolder(folder.root),
          separatorBefore: true,
        })
      }
      items.push({
        label: t('选择其他文件夹'),
        onClick: () => chooseFolderFrom(folder.root),
        separatorBefore: !parent || parent === folder.root,
      })
      items.push({
        label: t(revealLocationKey()),
        onClick: () => void desktop.reveal(folder.root),
      })
      items.push({ label: t('刷新'), onClick: refreshTree, separatorBefore: true })
      setCtxMenu({
        x,
        y,
        items,
      })
    },
    [
      folder,
      createFileIn,
      createFolderIn,
      openParentFolder,
      chooseFolderFrom,
      refreshTree,
      setCtxMenu,
    ],
  )

  return {
    treeKey,
    refreshTree,
    createFileIn,
    createFolderIn,
    renameNode,
    deleteNode,
    openNodeContext,
    openRootContext,
    expandedPathsRef,
    updateExpandedAfterMove,
    pushUndo,
    canUndo,
    undoLastOp,
  }
}
