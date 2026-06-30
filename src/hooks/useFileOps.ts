import { useCallback, useRef, useState } from 'react'
import { desktop } from '../platform'
import { getLang } from '../lib/i18n'
import type { Tab } from '../types'
import type { CloseDecision, CloseReason } from '../components/UnsavedChangesDialog'

let tabSeq = 0
const MAX_RESTORED_TABS = 12
const newTabId = (): string => `tab-${Date.now()}-${tabSeq++}`

/** Returns a unique "Untitled" name that doesn't conflict with open tabs. */
function newUntitledName(tabs: Tab[], lang: 'zh' | 'en'): string {
  const base = lang === 'en' ? 'Untitled' : '未命名'
  const ext = '.md'
  const names = new Set(tabs.map((t) => t.name))
  if (!names.has(`${base}${ext}`)) return `${base}${ext}`
  let i = 2
  while (names.has(`${base} ${i}${ext}`)) i++
  return `${base} ${i}${ext}`
}

interface Deps {
  pushRecentFile: (p: string) => void
  lang: 'zh' | 'en'
  requestCloseDecision: (tabs: Tab[], reason?: CloseReason) => Promise<CloseDecision>
}

/**
 * All tab and file operations: open, save, close, new, update content.
 * Extracted from App.tsx to keep concerns separate.
 */
export function useFileOps({ pushRecentFile, lang, requestCloseDecision }: Deps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Always-fresh ref for use inside callbacks
  const stateRef = useRef({ tabs, activeId })
  stateRef.current = { tabs, activeId }

  const activeTab = tabs.find((t) => t.id === activeId) ?? null

  // ── Open ───────────────────────────────────────────────────────────────────
  const openPath = useCallback(
    async (path: string, name?: string) => {
      const existing = stateRef.current.tabs.find((t) => t.path === path)
      if (existing) {
        setActiveId(existing.id)
        return
      }
      let file
      try {
        file = await desktop.readFile(path)
      } catch {
        window.alert(
          (getLang() === 'en' ? 'File not found or cannot open:\n' : '文件不存在或无法打开：\n') +
            path,
        )
        return
      }
      const tab: Tab = {
        id: newTabId(),
        path: file.path,
        name: name ?? file.name,
        content: file.content,
        savedContent: file.content,
        dirty: false,
      }
      setTabs((prev) => [...prev, tab])
      setActiveId(tab.id)
      pushRecentFile(file.path)
    },
    [pushRecentFile],
  )

  const openFile = useCallback(async () => {
    const file = await desktop.openFile()
    if (!file) return
    const existing = stateRef.current.tabs.find((t) => t.path === file.path)
    if (existing) {
      setActiveId(existing.id)
      return
    }
    const tab: Tab = {
      id: newTabId(),
      path: file.path,
      name: file.name,
      content: file.content,
      savedContent: file.content,
      dirty: false,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
    pushRecentFile(file.path)
  }, [pushRecentFile])

  const newFile = useCallback(() => {
    const name = newUntitledName(stateRef.current.tabs, lang)
    const tab: Tab = {
      id: newTabId(),
      path: null,
      name,
      content: '',
      savedContent: '',
      dirty: false,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [lang])

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return false
      try {
        if (tab.path) {
          await desktop.writeFile(tab.path, tab.content)
          setTabs((prev) =>
            prev.map((t) => (t.id === id ? { ...t, savedContent: tab.content, dirty: false } : t)),
          )
          return true
        } else {
          const result = await desktop.saveAs(tab.content, tab.name)
          if (result) {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      path: result.path,
                      name: result.name,
                      savedContent: tab.content,
                      dirty: false,
                    }
                  : t,
              ),
            )
            pushRecentFile(result.path)
            return true
          }
          return false
        }
      } catch {
        window.alert(
          getLang() === 'en'
            ? `Failed to save "${tab.name}". Check disk space or permissions.`
            : `保存「${tab.name}」失败，请检查磁盘空间或权限。`,
        )
        return false
      }
    },
    [pushRecentFile],
  )

  const saveAsTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return
      try {
        const result = await desktop.saveAs(tab.content, tab.name)
        if (result) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    path: result.path,
                    name: result.name,
                    savedContent: tab.content,
                    dirty: false,
                  }
                : t,
            ),
          )
          pushRecentFile(result.path)
        }
      } catch {
        window.alert(getLang() === 'en' ? 'Save As failed.' : '另存为失败。')
      }
    },
    [pushRecentFile],
  )

  // ── Content update ─────────────────────────────────────────────────────────
  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content, dirty: content !== t.savedContent } : t)),
    )
  }, [])

  // ── Close ──────────────────────────────────────────────────────────────────
  const confirmCloseTargets = useCallback(
    async (targets: Tab[]): Promise<boolean> => {
      const dirty = targets.filter((tab) => tab.dirty)
      if (dirty.length === 0) return true
      const decision = await requestCloseDecision(dirty, 'close')
      if (decision === 'cancel') return false
      if (decision === 'save') {
        for (const tab of dirty) {
          if (!(await saveTab(tab.id))) return false
        }
      }
      return true
    },
    [requestCloseDecision, saveTab],
  )

  const confirmCloseTabs = useCallback(
    (ids: readonly string[]): Promise<boolean> => {
      const targets = new Set(ids)
      return confirmCloseTargets(stateRef.current.tabs.filter((tab) => targets.has(tab.id)))
    },
    [confirmCloseTargets],
  )

  const closeTabsWithoutPrompt = useCallback((ids: readonly string[]): void => {
    const targets = new Set(ids)
    if (targets.size === 0) return
    const snapshot = stateRef.current.tabs
    setTabs((previous) => previous.filter((tab) => !targets.has(tab.id)))
    setActiveId((current) => {
      if (!current || !targets.has(current)) return current
      const currentIndex = snapshot.findIndex((tab) => tab.id === current)
      const nextTab = snapshot.slice(currentIndex + 1).find((tab) => !targets.has(tab.id))
      const previousTab = snapshot
        .slice(0, currentIndex)
        .reverse()
        .find((tab) => !targets.has(tab.id))
      return nextTab?.id ?? previousTab?.id ?? null
    })
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((item) => item.id === id)
      if (!tab || !(await confirmCloseTargets([tab]))) return
      closeTabsWithoutPrompt([id])
    },
    [closeTabsWithoutPrompt, confirmCloseTargets],
  )

  const closeOthers = useCallback(
    async (id: string) => {
      const current = stateRef.current.tabs
      const kept = current.find((tab) => tab.id === id)
      if (!kept) return
      const targets = current.filter((tab) => tab.id !== id)
      if (!(await confirmCloseTargets(targets))) return
      setTabs((prev) => prev.filter((tab) => tab.id === id))
      setActiveId(id)
    },
    [confirmCloseTargets],
  )

  const closeAllTabs = useCallback(async () => {
    const current = stateRef.current.tabs
    if (!(await confirmCloseTargets(current))) return
    setTabs([])
    setActiveId(null)
  }, [confirmCloseTargets])

  const closeLeft = useCallback(
    async (id: string) => {
      const current = stateRef.current.tabs
      const index = current.findIndex((tab) => tab.id === id)
      if (index <= 0) return
      const targets = current.slice(0, index)
      if (!(await confirmCloseTargets(targets))) return
      const targetIds = new Set(targets.map((tab) => tab.id))
      setTabs((prev) => prev.filter((tab) => !targetIds.has(tab.id)))
      setActiveId((active) => (active && !targetIds.has(active) ? active : id))
    },
    [confirmCloseTargets],
  )

  const closeRight = useCallback(
    async (id: string) => {
      const current = stateRef.current.tabs
      const index = current.findIndex((tab) => tab.id === id)
      if (index < 0 || index >= current.length - 1) return
      const targets = current.slice(index + 1)
      if (!(await confirmCloseTargets(targets))) return
      const targetIds = new Set(targets.map((tab) => tab.id))
      setTabs((prev) => prev.filter((tab) => !targetIds.has(tab.id)))
      setActiveId((active) => (active && !targetIds.has(active) ? active : id))
    },
    [confirmCloseTargets],
  )

  // ── Session restore ────────────────────────────────────────────────────────
  const restoreSession = useCallback(async (openFiles: string[], activePath: string | null) => {
    const restored = (
      await Promise.all(
        openFiles.slice(0, MAX_RESTORED_TABS).map(async (path): Promise<Tab | null> => {
          try {
            const file = await desktop.readFile(path)
            return {
              id: newTabId(),
              path: file.path,
              name: file.name,
              content: file.content,
              savedContent: file.content,
              dirty: false,
            }
          } catch {
            return null
          }
        }),
      )
    ).filter((tab): tab is Tab => tab !== null)
    if (restored.length) {
      setTabs(restored)
      const act = restored.find((t) => t.path === activePath) ?? restored[0]
      setActiveId(act.id)
    }
  }, [])

  // ── Dirty check for window close ──────────────────────────────────────────
  const hasDirtyTabs = useCallback((): boolean => stateRef.current.tabs.some((t) => t.dirty), [])

  return {
    tabs,
    setTabs,
    activeId,
    setActiveId,
    activeTab,
    stateRef,
    openPath,
    openFile,
    newFile,
    saveTab,
    saveAsTab,
    closeTab,
    closeOthers,
    closeAllTabs,
    closeLeft,
    closeRight,
    updateContent,
    restoreSession,
    hasDirtyTabs,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
  }
}
