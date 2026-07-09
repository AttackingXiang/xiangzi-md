import { useCallback, useRef, useState } from 'react'
import { desktop } from '../platform'
import { getLang, t } from '../lib/i18n'
import { ErrorCode } from '../lib/errorCodes'
import { createTaskQueue, mapWithConcurrencyLimit } from '../lib/asyncPool'
import { InFlightCache } from '../lib/inFlightCache'
import { LatestTaskQueue } from '../lib/latestTask'
import { completeSave } from '../lib/saveState'
import type { Draft, Tab } from '../types'
import type { CloseDecision, CloseReason } from '../components/UnsavedChangesDialog'

let tabSeq = 0
const MAX_RESTORED_TABS = 12
const RESTORE_CONCURRENCY = 2
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

function recoveredDraftName(name: string, lang: 'zh' | 'en'): string {
  const suffix = lang === 'en' ? ' (Recovered)' : '（已恢复）'
  if (name.includes(suffix)) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`
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
  const openQueueRef = useRef(createTaskQueue(2))
  const openTasksRef = useRef(new InFlightCache<string, void>())
  const saveQueuesRef = useRef(new LatestTaskQueue<string, boolean>())
  const savedVersionsRef = useRef(new Map<string, Tab['version']>())

  // Always-fresh ref for use inside callbacks
  const stateRef = useRef({ tabs, activeId })
  stateRef.current = { tabs, activeId }

  const activeTab = tabs.find((t) => t.id === activeId) ?? null

  // ── Open ───────────────────────────────────────────────────────────────────
  const openPath = useCallback(
    (path: string, name?: string): Promise<void> => {
      const existing = stateRef.current.tabs.find((t) => t.path === path)
      if (existing) {
        setActiveId(existing.id)
        return Promise.resolve()
      }
      return openTasksRef.current.getOrCreate(path, () =>
        openQueueRef.current.run(async () => {
          const openedWhileQueued = stateRef.current.tabs.find((tab) => tab.path === path)
          if (openedWhileQueued) {
            setActiveId(openedWhileQueued.id)
            return
          }
          let file
          try {
            file = await desktop.readFile(path)
          } catch {
            await desktop.notify(t('文件不存在或无法打开：\n') + path)
            return
          }
          const tab: Tab = {
            id: newTabId(),
            path: file.path,
            name: name ?? file.name,
            content: file.content,
            savedContent: file.content,
            dirty: false,
            revision: 0,
            version: file.version,
          }
          setTabs((prev) => [...prev, tab])
          setActiveId(tab.id)
          pushRecentFile(file.path)
        }),
      )
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
      revision: 0,
      version: file.version,
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
      revision: 0,
      version: null,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [lang])

  const recoverDraft = useCallback(
    (draft: Draft): void => {
      const existing = stateRef.current.tabs.find((tab) => tab.id === draft.id)
      if (existing) {
        setActiveId(existing.id)
        return
      }
      const tab: Tab = {
        id: draft.id,
        path: null,
        recoverySourcePath: draft.path,
        name: recoveredDraftName(draft.name, lang),
        content: draft.content,
        savedContent: '',
        dirty: true,
        revision: 1,
        version: null,
      }
      setTabs((previous) => [...previous, tab])
      setActiveId(tab.id)
    },
    [lang],
  )

  // ── Save ───────────────────────────────────────────────────────────────────
  const performSave = useCallback(
    async (id: string, force = false): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return false
      try {
        if (tab.path) {
          let result
          try {
            // force：批量标签改名等场景直接覆盖，跳过版本冲突检查/弹窗——写的正是
            // 我们刚基于当前内容改出来的结果，不该被“外部修改”挡住而悄悄存不进去。
            result = await desktop.writeFile(
              tab.path,
              tab.content,
              savedVersionsRef.current.get(id) ?? tab.version,
              force,
            )
          } catch (error) {
            const code =
              typeof error === 'object' && error !== null && 'code' in error
                ? String(error.code)
                : ''
            if (code !== ErrorCode.FILE_CONFLICT) throw error
            const overwrite = await desktop.confirm(
              getLang() === 'en'
                ? `”${tab.name}” changed on disk. Overwrite the external changes?`
                : `「${tab.name}」已被其他程序修改，是否覆盖外部更改？`,
              t('文件冲突'),
              t('仍然覆盖'),
              t('取消'),
            )
            if (!overwrite) return false
            result = await desktop.writeFile(
              tab.path,
              tab.content,
              savedVersionsRef.current.get(id) ?? tab.version,
              true,
            )
          }
          savedVersionsRef.current.set(id, result.version)
          setTabs((prev) =>
            prev.map((current) =>
              current.id === id ? completeSave(current, tab, result.version) : current,
            ),
          )
          return true
        } else {
          const result = await desktop.saveAs(tab.content, tab.name)
          if (result) {
            savedVersionsRef.current.set(id, result.version)
            setTabs((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...completeSave(t, tab, result.version),
                      path: result.path,
                      recoverySourcePath: null,
                      name: result.name,
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
        await desktop.notify(
          getLang() === 'en'
            ? `Failed to save "${tab.name}". Check disk space or permissions.`
            : `保存「${tab.name}」失败，请检查磁盘空间或权限。`,
        )
        return false
      }
    },
    [pushRecentFile],
  )

  const saveTab = useCallback(
    (id: string, force = false): Promise<boolean> =>
      saveQueuesRef.current.run(id, () => performSave(id, force)),
    [performSave],
  )

  // 内容已经由调用方直接写盘（如批量标签改名），这里只把结果并回标签页：置为
  // 干净、更新版本。不走 performSave 的 stateRef 读取——批量循环里 stateRef 可能
  // 还没随 React 提交刷新，会读到旧内容导致标签页停留在“待保存”。直接用确定的
  // content/version 落定，保证每个受影响的标签页都变成已保存。
  const markTabPersisted = useCallback(
    (id: string, content: string, version: NonNullable<Tab['version']>): void => {
      savedVersionsRef.current.set(id, version)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                content,
                savedContent: content,
                dirty: false,
                revision: t.revision + 1,
                version,
              }
            : t,
        ),
      )
    },
    [],
  )

  const saveAsTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return
      try {
        const result = await desktop.saveAs(tab.content, tab.name)
        if (result) {
          savedVersionsRef.current.set(id, result.version)
          setTabs((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...completeSave(t, tab, result.version),
                    path: result.path,
                    recoverySourcePath: null,
                    name: result.name,
                  }
                : t,
            ),
          )
          pushRecentFile(result.path)
        }
      } catch {
        await desktop.notify(t('另存为失败。'))
      }
    },
    [pushRecentFile],
  )

  // ── Content update ─────────────────────────────────────────────────────────
  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === id && content !== t.content
          ? {
              ...t,
              content,
              dirty: content !== t.savedContent,
              revision: t.revision + 1,
            }
          : t,
      )
      // Keep stateRef in sync synchronously (not just on next render) so a
      // caller can immediately follow updateContent with saveTab and have
      // performSave read this update via stateRef instead of a stale snapshot.
      stateRef.current = { ...stateRef.current, tabs: next }
      return next
    })
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
        const targetIds = new Set(dirty.map((tab) => tab.id))
        if (stateRef.current.tabs.some((tab) => targetIds.has(tab.id) && tab.dirty)) return false
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

  const moveTab = useCallback((fromIndex: number, insertAt: number): void => {
    setTabs((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        insertAt < 0 ||
        insertAt > prev.length ||
        fromIndex === insertAt ||
        fromIndex === insertAt - 1
      )
        return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(insertAt > fromIndex ? insertAt - 1 : insertAt, 0, moved)
      return next
    })
  }, [])

  const toggleTabLock = useCallback((id: string): void => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, locked: !tab.locked } : tab)))
  }, [])

  const closeTabsWithoutPrompt = useCallback((ids: readonly string[]): void => {
    const targets = new Set(ids)
    if (targets.size === 0) return
    const snapshot = stateRef.current.tabs
    // Never close locked tabs
    const closeable = new Set(
      snapshot.filter((t) => targets.has(t.id) && !t.locked).map((t) => t.id),
    )
    if (closeable.size === 0) return
    setTabs((previous) => previous.filter((tab) => !closeable.has(tab.id)))
    setActiveId((current) => {
      // Only reassign focus if the currently active tab is actually being closed
      if (!current || !closeable.has(current)) return current
      const currentIndex = snapshot.findIndex((tab) => tab.id === current)
      const nextTab = snapshot.slice(currentIndex + 1).find((tab) => !closeable.has(tab.id))
      const previousTab = snapshot
        .slice(0, currentIndex)
        .reverse()
        .find((tab) => !closeable.has(tab.id))
      return nextTab?.id ?? previousTab?.id ?? null
    })
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((item) => item.id === id)
      if (!tab || tab.locked || !(await confirmCloseTargets([tab]))) return
      closeTabsWithoutPrompt([id])
    },
    [closeTabsWithoutPrompt, confirmCloseTargets],
  )

  const closeOthers = useCallback(
    async (id: string) => {
      const current = stateRef.current.tabs
      if (!current.find((tab) => tab.id === id)) return
      const targets = current.filter((tab) => tab.id !== id && !tab.locked)
      // Nothing to close (all others are locked) — just activate the tab
      if (targets.length === 0) {
        setActiveId(id)
        return
      }
      if (!(await confirmCloseTargets(targets))) return
      const targetIds = new Set(targets.map((tab) => tab.id))
      setTabs((prev) => prev.filter((tab) => !targetIds.has(tab.id)))
      setActiveId(id)
    },
    [confirmCloseTargets],
  )

  const closeAllTabs = useCallback(async () => {
    const current = stateRef.current.tabs
    const targets = current.filter((tab) => !tab.locked)
    if (!(await confirmCloseTargets(targets))) return
    const targetIds = new Set(targets.map((tab) => tab.id))
    setTabs((prev) => prev.filter((tab) => !targetIds.has(tab.id)))
    if (targetIds.size > 0) {
      // Fall back to first locked (pinned) tab rather than null when locked tabs remain
      const firstLockedId = current.find((t) => t.locked)?.id ?? null
      setActiveId((active) => (active && !targetIds.has(active) ? active : firstLockedId))
    }
  }, [confirmCloseTargets])

  const closeLeft = useCallback(
    async (id: string) => {
      const current = stateRef.current.tabs
      const index = current.findIndex((tab) => tab.id === id)
      if (index <= 0) return
      const targets = current.slice(0, index).filter((tab) => !tab.locked)
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
      const targets = current.slice(index + 1).filter((tab) => !tab.locked)
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
      await mapWithConcurrencyLimit(
        openFiles.slice(0, MAX_RESTORED_TABS),
        RESTORE_CONCURRENCY,
        async (path): Promise<Tab | null> => {
          try {
            const file = await desktop.readFile(path)
            return {
              id: newTabId(),
              path: file.path,
              name: file.name,
              content: file.content,
              savedContent: file.content,
              dirty: false,
              revision: 0,
              version: file.version,
            }
          } catch {
            return null
          }
        },
      )
    ).filter((tab): tab is Tab => tab !== null)
    if (restored.length) {
      const act = restored.find((t) => t.path === activePath) ?? restored[0]
      setTabs((current) => {
        if (current.length === 0) return restored
        const existingPaths = new Set(current.flatMap((tab) => (tab.path ? [tab.path] : [])))
        return [...current, ...restored.filter((tab) => !tab.path || !existingPaths.has(tab.path))]
      })
      setActiveId((current) => current ?? act.id)
    }
  }, [])

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
    recoverDraft,
    saveTab,
    markTabPersisted,
    saveAsTab,
    moveTab,
    toggleTabLock,
    closeTab,
    closeOthers,
    closeAllTabs,
    closeLeft,
    closeRight,
    updateContent,
    restoreSession,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
  }
}
