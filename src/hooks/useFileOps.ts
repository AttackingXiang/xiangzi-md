import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { getLang, t } from '../lib/i18n'
import { ErrorCode } from '../lib/errorCodes'
import { createTaskQueue, mapWithConcurrencyLimit } from '../lib/asyncPool'
import { InFlightCache } from '../lib/inFlightCache'
import { LatestTaskQueue } from '../lib/latestTask'
import {
  acceptExternalRead,
  applyRecoveredDraft,
  completePersistedTransform,
  completeSave,
  markExternalUnavailable,
  reconcileExternalRead,
  updateTabContent,
} from '../lib/saveState'
import { activateOrAppendTab, mergeRestoredTabs, tabsAreClean } from '../lib/documentState'
import { isKnownTextFile } from '../lib/fileKind'
import { saveDialogExtensions } from '../lib/fileCapabilities'
import type { DraftRecoveryResult } from '../lib/draftRecovery'
import { applyLineEnding, detectLineEnding } from '../lib/lineEndings'
import { baseName } from '../lib/path'
import { documentPathKey, sameDocumentPath } from '../lib/pathIdentity'
import {
  saveOperationSucceeded,
  type OpenPathResult,
  type SaveOperationResult,
} from '../lib/documentOperations'
import type { Draft, Tab } from '../types'
import type { OpenedFile } from '../platform/contracts'
import type { CloseDecision, CloseReason } from '../components/UnsavedChangesDialog'
import { useExternalFileWatcher } from './useExternalFileWatcher'

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
  lang: 'zh' | 'en'
  requestCloseDecision: (tabs: Tab[], reason?: CloseReason) => Promise<CloseDecision>
  /** 保存成功后记一次编辑，喂给 frecency 的「最近修改」信号（见 recordDocEdit）。 */
  recordDocEdit: (p: string) => void
}

/**
 * All tab and file operations: open, save, close, new, update content.
 * Extracted from App.tsx to keep concerns separate.
 *
 * 注：「最近打开」不在这里记录——打开一个文件是否算数由 App 层的停留门控决定
 * （见 recordDocOpen 的调用），避免误点/快速翻找污染 frecency 语料。
 */
export function useFileOps({ lang, requestCloseDecision, recordDocEdit }: Deps) {
  const [tabs, setTabsState] = useState<Tab[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const openQueueRef = useRef(createTaskQueue(2))
  const openTasksRef = useRef(new InFlightCache<string, OpenPathResult>())
  const saveQueuesRef = useRef(new LatestTaskQueue<string, SaveOperationResult>())
  const saveAsTargetOwnersRef = useRef(new Map<string, string>())
  const savedVersionsRef = useRef(new Map<string, Tab['version']>())
  const savingIdsRef = useRef(new Set<string>())
  const pendingExternalChecksRef = useRef(new Set<string>())
  const externalCheckSequenceRef = useRef(new Map<string, number>())
  const checkExternalChangesRef = useRef<(paths?: readonly string[]) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const [externalReloadNotice, setExternalReloadNotice] = useState<{
    sequence: number
    name: string
  } | null>(null)
  const externalReloadSequenceRef = useRef(0)

  // Always-fresh ref for use inside callbacks
  const stateRef = useRef({ tabs, activeId })
  stateRef.current = { tabs, activeId }
  const tabMutationRef = useRef(0)
  const activeMutationRef = useRef(0)

  // File commands often intentionally chain an in-memory mutation and an I/O
  // operation in the same tick (property update -> save is one example). React
  // does not guarantee that a functional state updater has run before the next
  // line of user code, so keep the command-side snapshot authoritative eagerly.
  const setTabs = useCallback<Dispatch<SetStateAction<Tab[]>>>((action) => {
    const apply = typeof action === 'function' ? action : () => action
    const base = stateRef.current.tabs
    const optimistic = apply(base)
    const mutation = ++tabMutationRef.current
    stateRef.current = { ...stateRef.current, tabs: optimistic }
    setTabsState((previous) => {
      const next = previous === base ? optimistic : apply(previous)
      if (tabMutationRef.current === mutation) {
        stateRef.current = { ...stateRef.current, tabs: next }
      }
      return next
    })
  }, [])

  const setActiveId = useCallback<Dispatch<SetStateAction<string | null>>>((action) => {
    const apply = typeof action === 'function' ? action : () => action
    const base = stateRef.current.activeId
    const optimistic = apply(base)
    const mutation = ++activeMutationRef.current
    stateRef.current = { ...stateRef.current, activeId: optimistic }
    setActiveIdState((previous) => {
      const next = previous === base ? optimistic : apply(previous)
      if (activeMutationRef.current === mutation) {
        stateRef.current = { ...stateRef.current, activeId: next }
      }
      return next
    })
  }, [])

  const activeTab = tabs.find((t) => t.id === activeId) ?? null

  const activateOpenedTab = useCallback(
    (tab: Tab): { tabId: string; opened: boolean } => {
      const current = stateRef.current.tabs
      const result = activateOrAppendTab(current, tab)
      setTabs(result.tabs)
      setActiveId(result.activeId)
      return { tabId: result.activeId ?? tab.id, opened: result.tabs !== current }
    },
    [setActiveId, setTabs],
  )

  // ── Open ───────────────────────────────────────────────────────────────────
  const openPath = useCallback(
    (path: string, name?: string): Promise<OpenPathResult> => {
      const existing = stateRef.current.tabs.find(
        (tab) => tab.path && sameDocumentPath(tab.path, path),
      )
      if (existing) {
        setActiveId(existing.id)
        return Promise.resolve({
          kind: 'activated',
          path: existing.path ?? path,
          tabId: existing.id,
        })
      }
      // 与文件树 openable / Rust is_known_text 对齐：Markdown、无扩展名、已知文本
      // 才放行。挡住最近文件里已变成二进制/未知类型的陈旧条目，避免误进 TextEditor。
      if (!isKnownTextFile(name ?? path)) {
        void desktop.notify(t('无法打开该类型的文件：\n') + path)
        return Promise.resolve({ kind: 'failed', path, reason: 'unsupported' })
      }
      return openTasksRef.current.getOrCreate(documentPathKey(path), () =>
        openQueueRef.current.run(async () => {
          const openedWhileQueued = stateRef.current.tabs.find(
            (tab) => tab.path && sameDocumentPath(tab.path, path),
          )
          if (openedWhileQueued) {
            setActiveId(openedWhileQueued.id)
            return {
              kind: 'activated',
              path: openedWhileQueued.path ?? path,
              tabId: openedWhileQueued.id,
            }
          }
          let file
          try {
            file = await desktop.readFile(path)
          } catch {
            await desktop.notify(t('文件不存在或无法打开：\n') + path)
            return { kind: 'failed', path, reason: 'unavailable' }
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
            eol: detectLineEnding(file.content),
          }
          const activation = activateOpenedTab(tab)
          return {
            kind: activation.opened ? 'opened' : 'activated',
            path: file.path,
            tabId: activation.tabId,
          }
        }),
      )
    },
    [activateOpenedTab, setActiveId],
  )

  const openFile = useCallback(async () => {
    const file = await desktop.openFile()
    if (!file) return
    const existing = stateRef.current.tabs.find(
      (tab) => tab.path && sameDocumentPath(tab.path, file.path),
    )
    if (existing) {
      setActiveId(existing.id)
      return
    }
    await openTasksRef.current.getOrCreate(documentPathKey(file.path), () => {
      const activation = activateOpenedTab({
        id: newTabId(),
        path: file.path,
        name: file.name,
        content: file.content,
        savedContent: file.content,
        dirty: false,
        revision: 0,
        version: file.version,
        eol: detectLineEnding(file.content),
      })
      return Promise.resolve({
        kind: activation.opened ? 'opened' : 'activated',
        path: file.path,
        tabId: activation.tabId,
      })
    })
  }, [activateOpenedTab, setActiveId])

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
      eol: 'lf',
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [lang, setActiveId, setTabs])

  const recoverDraft = useCallback(
    async (draft: Draft): Promise<DraftRecoveryResult> => {
      const existingById = stateRef.current.tabs.find((tab) => tab.id === draft.id)
      if (existingById) {
        setActiveId(existingById.id)
        return { kind: 'recovered', tabId: existingById.id }
      }

      // A draft without a path came from a genuinely new, never-saved document.
      // It cannot be restored to disk, so keep the existing recovered-tab flow.
      if (!draft.path) {
        const tab: Tab = {
          id: draft.id,
          path: null,
          recoverySourcePath: null,
          name: recoveredDraftName(draft.name, lang),
          content: draft.content,
          savedContent: '',
          dirty: true,
          revision: 1,
          version: null,
          // 草稿是应用内快照（content 早已是编辑器吐出的纯 LF 文本），不是原始
          // 磁盘字节，没有可还原的换行风格信号；跟新建文件一样按 'lf' 处理。
          eol: 'lf',
        }
        setTabs((previous) => [...previous, tab])
        setActiveId(tab.id)
        return { kind: 'recovered', tabId: tab.id }
      }

      // Session restoration can already have opened the original path with a new
      // runtime tab id. Reuse that tab instead of creating a duplicate.
      const existingByPath = stateRef.current.tabs.find(
        (tab) => tab.path && sameDocumentPath(tab.path, draft.path!),
      )
      if (existingByPath) {
        if (existingByPath.dirty) {
          setActiveId(existingByPath.id)
          void desktop.notify(t('该文档已有未保存的修改，草稿未自动恢复，避免覆盖当前内容。'))
          return {
            kind: 'blocked',
            tabId: existingByPath.id,
            reason: 'dirty-existing-path',
          }
        }
        setTabs((previous) =>
          previous.map((tab) =>
            tab.id === existingByPath.id ? applyRecoveredDraft(tab, draft.content) : tab,
          ),
        )
        setActiveId(existingByPath.id)
        return { kind: 'recovered', tabId: existingByPath.id }
      }

      try {
        const file = await desktop.readFile(draft.path)
        const openedWhileReading = stateRef.current.tabs.find(
          (tab) => tab.path && sameDocumentPath(tab.path, file.path),
        )
        if (openedWhileReading) {
          if (openedWhileReading.dirty) {
            setActiveId(openedWhileReading.id)
            void desktop.notify(t('该文档已有未保存的修改，草稿未自动恢复，避免覆盖当前内容。'))
            return {
              kind: 'blocked',
              tabId: openedWhileReading.id,
              reason: 'dirty-existing-path',
            }
          }
          setTabs((previous) =>
            previous.map((tab) =>
              tab.id === openedWhileReading.id ? applyRecoveredDraft(tab, draft.content) : tab,
            ),
          )
          setActiveId(openedWhileReading.id)
          return { kind: 'recovered', tabId: openedWhileReading.id }
        }

        const tab: Tab = {
          id: draft.id,
          path: file.path,
          recoverySourcePath: null,
          name: file.name,
          content: draft.content,
          savedContent: file.content,
          dirty: draft.content !== file.content,
          revision: 1,
          version: file.version,
          eol: detectLineEnding(file.content),
        }
        savedVersionsRef.current.set(tab.id, file.version)
        setTabs((previous) => [...previous, tab])
        setActiveId(tab.id)
        return { kind: 'recovered', tabId: tab.id }
      } catch {
        // The original file may have been deleted or moved. Preserve the draft
        // rather than losing it, but make it an explicit Save As recovery tab.
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
          eol: 'lf',
        }
        setTabs((previous) => [...previous, tab])
        setActiveId(tab.id)
        return { kind: 'recovered', tabId: tab.id }
      }
    },
    [lang, setActiveId, setTabs],
  )

  // ── Save ───────────────────────────────────────────────────────────────────
  const performSaveAs = useCallback(
    async (id: string): Promise<SaveOperationResult> => {
      const initial = stateRef.current.tabs.find((tab) => tab.id === id)
      if (!initial) return { kind: 'failed', tabId: id }
      try {
        const path = await desktop.pickSavePath(initial.name, saveDialogExtensions(initial.name))
        if (!path) return { kind: 'cancelled', tabId: id }

        // The save dialog can stay open while queued document work settles. Read
        // the authoritative tab again after selection so the newest content is
        // what lands at the chosen target.
        const tab = stateRef.current.tabs.find((current) => current.id === id)
        if (!tab) return { kind: 'cancelled', tabId: id }
        const duplicate = stateRef.current.tabs.find(
          (current) =>
            current.id !== id && current.path !== null && sameDocumentPath(current.path, path),
        )
        if (duplicate) {
          setActiveId(duplicate.id)
          await desktop.notify(t('该文件已在另一个标签页中打开，未执行另存为。'))
          return { kind: 'duplicate', path, tabId: id, existingTabId: duplicate.id }
        }

        const targetKey = documentPathKey(path)
        const pendingOwnerId = saveAsTargetOwnersRef.current.get(targetKey)
        if (pendingOwnerId && pendingOwnerId !== id) {
          if (stateRef.current.tabs.some((current) => current.id === pendingOwnerId)) {
            setActiveId(pendingOwnerId)
          }
          await desktop.notify(t('该文件正在另一个标签页中另存为，未执行本次写入。'))
          return { kind: 'duplicate', path, tabId: id, existingTabId: pendingOwnerId }
        }

        saveAsTargetOwnersRef.current.set(targetKey, id)
        try {
          const result = await desktop.writeFile(
            path,
            applyLineEnding(tab.content, tab.eol ?? 'lf'),
            null,
            true,
          )
          savedVersionsRef.current.set(id, result.version)
          setTabs((previous) =>
            previous.map((current) =>
              current.id === id
                ? {
                    ...completeSave(current, tab, result.version),
                    path,
                    recoverySourcePath: null,
                    name: baseName(path) || tab.name,
                  }
                : current,
            ),
          )
          recordDocEdit(path)
          return { kind: 'saved', path, tabId: id }
        } finally {
          if (saveAsTargetOwnersRef.current.get(targetKey) === id) {
            saveAsTargetOwnersRef.current.delete(targetKey)
          }
        }
      } catch {
        await desktop.notify(t('另存为失败。'))
        return { kind: 'failed', tabId: id }
      }
    },
    [recordDocEdit, setActiveId, setTabs],
  )

  const performSave = useCallback(
    async (id: string, force = false): Promise<SaveOperationResult> => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return { kind: 'failed', tabId: id }
      if (!tab.path) return performSaveAs(id)
      if (tab.path) savingIdsRef.current.add(id)
      try {
        // tab.content/mirror 一律是编辑器吐出的纯 LF 文本；磁盘要按这份文档原始
        // 的换行风格落盘，写盘前统一在这里转换一次。转换只影响发给 desktop 的
        // 字节，Tab 状态本身继续保持纯 LF。
        const diskContent = applyLineEnding(tab.content, tab.eol ?? 'lf')
        let result
        try {
          result = await desktop.writeFile(
            tab.path,
            diskContent,
            savedVersionsRef.current.get(id) ?? tab.version,
            force,
          )
        } catch (error) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
          if (code !== ErrorCode.FILE_CONFLICT) throw error
          pendingExternalChecksRef.current.add(id)
          return { kind: 'conflict', tabId: id }
        }
        savedVersionsRef.current.set(id, result.version)
        setTabs((prev) =>
          prev.map((current) =>
            current.id === id ? completeSave(current, tab, result.version) : current,
          ),
        )
        recordDocEdit(tab.path)
        return { kind: 'saved', path: tab.path, tabId: id }
      } catch {
        await desktop.notify(
          getLang() === 'en'
            ? `Failed to save "${tab.name}". Check disk space or permissions.`
            : `保存「${tab.name}」失败，请检查磁盘空间或权限。`,
        )
        return { kind: 'failed', tabId: id }
      } finally {
        if (tab.path) {
          savingIdsRef.current.delete(id)
          if (pendingExternalChecksRef.current.delete(id)) {
            queueMicrotask(() => void checkExternalChangesRef.current([tab.path as string]))
          }
        }
      }
    },
    [performSaveAs, recordDocEdit, setTabs],
  )

  const saveTab = useCallback(
    async (id: string, force = false): Promise<boolean> =>
      saveOperationSucceeded(await saveQueuesRef.current.run(id, () => performSave(id, force))),
    [performSave],
  )

  // 内容已经由调用方直接写盘（如批量标签改名），这里只把结果并回标签页：置为
  // 干净、更新版本。不走 performSave 的 stateRef 读取——批量循环里 stateRef 可能
  // 还没随 React 提交刷新，会读到旧内容导致标签页停留在“待保存”。直接用确定的
  // content/version 落定，保证每个受影响的标签页都变成已保存。
  const markTabPersisted = useCallback(
    (
      id: string,
      baseContent: string,
      content: string,
      version: NonNullable<Tab['version']>,
    ): void => {
      savedVersionsRef.current.set(id, version)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id ? completePersistedTransform(t, baseContent, content, version) : t,
        ),
      )
    },
    [setTabs],
  )

  const saveAsTab = useCallback(
    (id: string): Promise<SaveOperationResult> =>
      saveQueuesRef.current.run(id, () => performSaveAs(id)),
    [performSaveAs],
  )

  // ── Content update ─────────────────────────────────────────────────────────
  const updateContent = useCallback(
    (id: string, content: string) => {
      setTabs((prev) => prev.map((tab) => (tab.id === id ? updateTabContent(tab, content) : tab)))
    },
    [setTabs],
  )

  const checkExternalChanges = useCallback(
    async (paths?: readonly string[]): Promise<void> => {
      const targets = paths ? new Set(paths.map(documentPathKey)) : null
      const candidates = stateRef.current.tabs.filter(
        (tab) => tab.path && tab.version && (!targets || targets.has(documentPathKey(tab.path))),
      )
      await mapWithConcurrencyLimit(candidates, 4, async (candidate) => {
        if (!candidate.path) return
        const candidatePath = candidate.path
        if (savingIdsRef.current.has(candidate.id)) {
          pendingExternalChecksRef.current.add(candidate.id)
          return
        }
        const checkSequence = (externalCheckSequenceRef.current.get(candidate.id) ?? 0) + 1
        externalCheckSequenceRef.current.set(candidate.id, checkSequence)

        let file: OpenedFile | undefined
        try {
          file = await desktop.readFile(candidatePath)
        } catch {
          let shouldMarkUnavailable = true
          // Atomic-save tools can briefly remove the destination between rename events.
          await new Promise((resolve) => setTimeout(resolve, 180))
          try {
            file = await desktop.readFile(candidatePath)
            shouldMarkUnavailable = false
          } catch {
            // The banner deliberately says unavailable rather than assuming deletion.
          }
          if (shouldMarkUnavailable) {
            if (externalCheckSequenceRef.current.get(candidate.id) !== checkSequence) return
            setTabs((previous) =>
              previous.map((tab) =>
                tab.id === candidate.id &&
                tab.path !== null &&
                sameDocumentPath(tab.path, candidatePath)
                  ? markExternalUnavailable(tab, Date.now())
                  : tab,
              ),
            )
            return
          }
        }
        if (!file) return
        if (externalCheckSequenceRef.current.get(candidate.id) !== checkSequence) return

        let reloadedName: string | null = null
        let reloadedVersion: Tab['version'] = null
        setTabs((previous) =>
          previous.map((tab) => {
            if (
              tab.id !== candidate.id ||
              tab.path === null ||
              !sameDocumentPath(tab.path, candidatePath)
            )
              return tab
            const result = reconcileExternalRead(tab, file)
            if (result.outcome === 'reloaded') {
              reloadedName = tab.name
              reloadedVersion = file.version
            }
            return result.tab
          }),
        )
        if (reloadedVersion) savedVersionsRef.current.set(candidate.id, reloadedVersion)
        if (reloadedName) {
          setExternalReloadNotice({
            sequence: ++externalReloadSequenceRef.current,
            name: reloadedName,
          })
        }
      })
    },
    [setTabs],
  )
  checkExternalChangesRef.current = checkExternalChanges

  const reloadTabFromDisk = useCallback(
    async (id: string): Promise<void> => {
      const tab = stateRef.current.tabs.find((item) => item.id === id)
      if (!tab?.path) return
      const requestedPath = tab.path
      const requestedRevision = tab.revision
      try {
        const file = await desktop.readFile(requestedPath)
        let accepted = false
        setTabs((previous) =>
          previous.map((current) => {
            if (
              current.id !== id ||
              current.path === null ||
              !sameDocumentPath(current.path, requestedPath)
            )
              return current
            if (current.revision !== requestedRevision) {
              return reconcileExternalRead(current, file).tab
            }
            accepted = true
            return acceptExternalRead(current, file)
          }),
        )
        if (accepted) savedVersionsRef.current.set(id, file.version)
      } catch {
        setTabs((previous) =>
          previous.map((current) =>
            current.id === id ? markExternalUnavailable(current, Date.now()) : current,
          ),
        )
      }
    },
    [setTabs],
  )

  const overwriteExternalTab = useCallback(
    async (id: string): Promise<void> => {
      await saveTab(id, true)
    },
    [saveTab],
  )

  useExternalFileWatcher({ tabs, activeId, checkPaths: checkExternalChanges })

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
        if (!tabsAreClean(stateRef.current.tabs, targetIds)) return false
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

  const moveTab = useCallback(
    (fromIndex: number, insertAt: number): void => {
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
    },
    [setTabs],
  )

  const toggleTabLock = useCallback(
    (id: string): void => {
      setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, locked: !tab.locked } : tab)))
    },
    [setTabs],
  )

  const closeTabsWithoutPrompt = useCallback(
    (ids: readonly string[]): void => {
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
    },
    [setActiveId, setTabs],
  )

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
    [confirmCloseTargets, setActiveId, setTabs],
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
  }, [confirmCloseTargets, setActiveId, setTabs])

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
    [confirmCloseTargets, setActiveId, setTabs],
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
    [confirmCloseTargets, setActiveId, setTabs],
  )

  // ── Session restore ────────────────────────────────────────────────────────
  const restoreSession = useCallback(
    async (openFiles: string[], activePath: string | null) => {
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
                eol: detectLineEnding(file.content),
              }
            } catch {
              return null
            }
          },
        )
      ).filter((tab): tab is Tab => tab !== null)
      if (restored.length) {
        const result = mergeRestoredTabs(
          stateRef.current.tabs,
          restored,
          activePath,
          stateRef.current.activeId,
        )
        setTabs(result.tabs)
        setActiveId(result.activeId)
      }
    },
    [setActiveId, setTabs],
  )

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
    checkExternalChanges,
    reloadTabFromDisk,
    overwriteExternalTab,
    externalReloadNotice,
    dismissExternalReloadNotice: () => setExternalReloadNotice(null),
  }
}
