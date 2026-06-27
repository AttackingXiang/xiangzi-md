import { useCallback, useRef, useState } from 'react'
import { desktop } from '../platform'
import { getLang } from '../lib/i18n'
import type { Tab } from '../types'

let tabSeq = 0
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
}

/**
 * All tab and file operations: open, save, close, new, update content.
 * Extracted from App.tsx to keep concerns separate.
 */
export function useFileOps({ pushRecentFile, lang }: Deps) {
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
      dirty: false,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
    pushRecentFile(file.path)
  }, [pushRecentFile])

  const newFile = useCallback(() => {
    const name = newUntitledName(stateRef.current.tabs, lang)
    const tab: Tab = { id: newTabId(), path: null, name, content: '', dirty: false }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [lang])

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return
      try {
        if (tab.path) {
          await desktop.writeFile(tab.path, tab.content)
          setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, dirty: false } : t)))
        } else {
          const result = await desktop.saveAs(tab.content, tab.name)
          if (result) {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === id ? { ...t, path: result.path, name: result.name, dirty: false } : t,
              ),
            )
            pushRecentFile(result.path)
          }
        }
      } catch {
        window.alert(
          getLang() === 'en'
            ? `Failed to save "${tab.name}". Check disk space or permissions.`
            : `保存「${tab.name}」失败，请检查磁盘空间或权限。`,
        )
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
              t.id === id ? { ...t, path: result.path, name: result.name, dirty: false } : t,
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
      prev.map((t) =>
        t.id === id ? { ...t, content, dirty: t.content !== content || t.dirty } : t,
      ),
    )
  }, [])

  // ── Close ──────────────────────────────────────────────────────────────────
  const confirmClose = (tab: Tab): boolean => {
    if (!tab.dirty) return true
    return window.confirm(
      getLang() === 'en'
        ? `"${tab.name}" has unsaved changes. Close anyway?`
        : `「${tab.name}」有未保存的修改，确定关闭？`,
    )
  }

  const closeTab = useCallback((id: string) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    if (!tab || !confirmClose(tab)) return
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      setActiveId((curr) => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  const closeOthers = useCallback((id: string) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    if (!tab) return
    const others = stateRef.current.tabs.filter((t) => t.id !== id && t.dirty)
    if (others.length > 0) {
      const names = others.map((t) => `• ${t.name}`).join('\n')
      const msg =
        getLang() === 'en'
          ? `These tabs have unsaved changes:\n${names}\n\nClose them anyway?`
          : `以下标签有未保存的修改：\n${names}\n\n确定关闭？`
      if (!window.confirm(msg)) return
    }
    setTabs([tab])
    setActiveId(id)
  }, [])

  const closeAllTabs = useCallback(() => {
    const dirty = stateRef.current.tabs.filter((t) => t.dirty)
    if (dirty.length > 0) {
      const names = dirty.map((t) => `• ${t.name}`).join('\n')
      const msg =
        getLang() === 'en'
          ? `These tabs have unsaved changes:\n${names}\n\nClose all anyway?`
          : `以下标签有未保存的修改：\n${names}\n\n确定全部关闭？`
      if (!window.confirm(msg)) return
    }
    setTabs([])
    setActiveId(null)
  }, [])

  const closeLeft = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx <= 0) return prev
      const toClose = prev.slice(0, idx).filter((t) => t.dirty)
      if (toClose.length > 0) {
        const msg =
          getLang() === 'en'
            ? `${toClose.length} tab(s) to the left have unsaved changes. Close anyway?`
            : `左侧有 ${toClose.length} 个标签未保存，确定关闭？`
        if (!window.confirm(msg)) return prev
      }
      const next = prev.slice(idx)
      setActiveId((curr) => (next.some((t) => t.id === curr) ? curr : id))
      return next
    })
  }, [])

  const closeRight = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const toClose = prev.slice(idx + 1).filter((t) => t.dirty)
      if (toClose.length > 0) {
        const msg =
          getLang() === 'en'
            ? `${toClose.length} tab(s) to the right have unsaved changes. Close anyway?`
            : `右侧有 ${toClose.length} 个标签未保存，确定关闭？`
        if (!window.confirm(msg)) return prev
      }
      const next = prev.slice(0, idx + 1)
      setActiveId((curr) => (next.some((t) => t.id === curr) ? curr : id))
      return next
    })
  }, [])

  // ── Session restore ────────────────────────────────────────────────────────
  const restoreSession = useCallback(async (openFiles: string[], activePath: string | null) => {
    const restored: Tab[] = []
    for (const p of openFiles) {
      try {
        const f = await desktop.readFile(p)
        restored.push({
          id: newTabId(),
          path: f.path,
          name: f.name,
          content: f.content,
          dirty: false,
        })
      } catch {
        /* file gone */
      }
    }
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
  }
}
