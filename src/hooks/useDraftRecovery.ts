import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '../platform'
import type { Draft, DraftSummary, Tab } from '../types'
import { t } from '../lib/i18n'

interface Deps {
  tabs: Tab[]
  getCurrentTabs: () => Tab[]
  openRecoveredDraft: (draft: Draft) => void
}

/**
 * Persists dirty tabs as bounded Rust-side snapshots and exposes the recovery
 * dialog state. Previous-run drafts are never deleted unless the user recovers
 * or explicitly removes them.
 */
export function useDraftRecovery({ tabs, getCurrentTabs, openRecoveredDraft }: Deps) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [isOpen, setOpen] = useState(false)
  const loadedRef = useRef(false)
  const managedIdsRef = useRef(new Set<string>())
  const writeVersionsRef = useRef(new Map<string, number>())
  const writePromisesRef = useRef(new Map<string, Promise<void>>())
  const snapshotRevisionsRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void desktop
      .listDrafts()
      .then((storedDrafts) => {
        setDrafts(storedDrafts)
        if (storedDrafts.length > 0) setOpen(true)
      })
      .catch((error: unknown) => console.error('Draft listing failed', error))
  }, [])

  const deleteDrafts = useCallback(async (ids: readonly string[]): Promise<void> => {
    await Promise.all(
      ids.map(async (id) => {
        const nextVersion = (writeVersionsRef.current.get(id) ?? 0) + 1
        writeVersionsRef.current.set(id, nextVersion)
        managedIdsRef.current.delete(id)
        snapshotRevisionsRef.current.delete(id)
        try {
          await writePromisesRef.current.get(id)
          await desktop.deleteDraft(id)
        } catch (error) {
          console.error('Draft deletion failed', error)
        }
      }),
    )
    const removed = new Set(ids)
    setDrafts((current) => current.filter((draft) => !removed.has(draft.id)))
  }, [])

  const snapshotDirtyTabs = useCallback((): void => {
    for (const tab of getCurrentTabs()) {
      if (
        !tab.dirty ||
        snapshotRevisionsRef.current.get(tab.id) === tab.revision ||
        writePromisesRef.current.has(tab.id)
      ) {
        continue
      }
      const version = (writeVersionsRef.current.get(tab.id) ?? 0) + 1
      writeVersionsRef.current.set(tab.id, version)
      const write = desktop
        .saveDraft(tab.id, tab.path ?? tab.recoverySourcePath ?? null, tab.name, tab.content)
        .then(async () => {
          const currentTab = getCurrentTabs().find((item) => item.id === tab.id)
          const isCurrent = writeVersionsRef.current.get(tab.id) === version
          if (isCurrent && currentTab?.dirty) {
            managedIdsRef.current.add(tab.id)
            snapshotRevisionsRef.current.set(tab.id, tab.revision)
            return
          }
          if (isCurrent || !currentTab?.dirty) await desktop.deleteDraft(tab.id)
        })
        .catch((error: unknown) => console.error('Draft snapshot failed', error))
      writePromisesRef.current.set(tab.id, write)
      void write.finally(() => {
        if (writePromisesRef.current.get(tab.id) === write) {
          writePromisesRef.current.delete(tab.id)
        }
      })
    }
  }, [getCurrentTabs])

  useEffect(() => {
    const dirtyIds = new Set(tabs.filter((tab) => tab.dirty).map((tab) => tab.id))
    const staleManagedIds = [...managedIdsRef.current].filter((id) => !dirtyIds.has(id))
    if (staleManagedIds.length > 0) void deleteDrafts(staleManagedIds)

    if (!tabs.some((tab) => tab.dirty)) return undefined
    const timer = window.setTimeout(snapshotDirtyTabs, 1200)
    return () => window.clearTimeout(timer)
  }, [deleteDrafts, snapshotDirtyTabs, tabs])

  useEffect(() => {
    const interval = window.setInterval(snapshotDirtyTabs, 5000)
    return () => window.clearInterval(interval)
  }, [snapshotDirtyTabs])

  const recover = useCallback(
    async (summary: DraftSummary): Promise<void> => {
      try {
        const draft = await desktop.readDraft(summary.id)
        managedIdsRef.current.add(draft.id)
        openRecoveredDraft(draft)
        setDrafts((current) => current.filter((item) => item.id !== draft.id))
        setOpen(false)
      } catch (error) {
        console.error('Draft recovery failed', error)
        window.alert(t('草稿恢复失败'))
      }
    },
    [openRecoveredDraft],
  )

  const clearRuntimeDrafts = useCallback(
    (): Promise<void> =>
      deleteDrafts([
        ...new Set([
          ...managedIdsRef.current,
          ...writePromisesRef.current.keys(),
          ...snapshotRevisionsRef.current.keys(),
        ]),
      ]),
    [deleteDrafts],
  )

  return {
    drafts,
    isOpen,
    setOpen,
    recover,
    deleteDrafts,
    clearRuntimeDrafts,
  }
}
