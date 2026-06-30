import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { getLang, t } from '../lib/i18n'
import { revealLocationKey } from '../lib/platform'
import { baseName } from '../lib/path'
import { replaceMovedPath } from '../lib/treeDrag'
import { removeWorkspacePath } from '../lib/workspaceRemoval'
import type { FileNode, Folder, Tab } from '../types'
import type { MenuItem } from '../components/ContextMenu'

interface Deps {
  folder: Folder | null
  setFolder: (updater: (prev: Folder | null) => Folder | null) => void
  openPath: (path: string, name?: string) => Promise<void>
  confirmCloseTabs: (ids: readonly string[]) => Promise<boolean>
  closeTabsWithoutPrompt: (ids: readonly string[]) => void
  tabs: Tab[]
  setTabs: Dispatch<SetStateAction<Tab[]>>
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
  setCtxMenu,
  setInputDialog,
}: Deps) {
  const [treeKey, setTreeKey] = useState(0)

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
            setTabs((current) =>
              current.map((tab) => {
                if (!tab.path) return tab
                const nextPath = replaceMovedPath(tab.path, node.path, res.path)
                return nextPath === tab.path
                  ? tab
                  : { ...tab, path: nextPath, name: baseName(nextPath) || res.name }
              }),
            )
            await refreshTree()
          } catch {
            window.alert(t('重命名失败'))
          }
        },
      })
    },
    [refreshTree, setInputDialog, setTabs],
  )

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
      } else {
        items.push({ label: t('打开'), onClick: () => openPath(node.path, node.name) })
      }
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
    [createFileIn, createFolderIn, openPath, renameNode, deleteNode, setCtxMenu],
  )

  const openRootContext = useCallback(
    (x: number, y: number) => {
      if (!folder) return
      setCtxMenu({
        x,
        y,
        items: [
          { label: t('新建文件'), onClick: () => createFileIn(folder.root) },
          { label: t('新建文件夹'), onClick: () => createFolderIn(folder.root) },
          { label: t('刷新'), onClick: refreshTree, separatorBefore: true },
        ],
      })
    },
    [folder, createFileIn, createFolderIn, refreshTree, setCtxMenu],
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
  }
}
