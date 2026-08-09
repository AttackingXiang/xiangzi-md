import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import type { AppSettings, Folder, Tab } from '../types'

export function workspaceSessionSnapshot(
  folderRoot: string | null,
  tabs: readonly Tab[],
  activePath: string | null,
): AppSettings['session'] {
  return {
    folder: folderRoot,
    openFiles: tabs.flatMap((tab) => (tab.path ? [tab.path] : [])),
    activePath,
  }
}

interface Options {
  settingsReady: boolean
  settings: AppSettings | null
  folder: Folder | null
  tabs: Tab[]
  activePath: string | null
  setFolder: Dispatch<SetStateAction<Folder | null>>
  restoreSession: (openFiles: string[], activePath: string | null) => Promise<void>
  persistSettings: (patch: Partial<AppSettings>, context: string) => void
}

/** Coordinates one-time restoration with debounced, race-safe persistence. */
export function useWorkspaceSession({
  settingsReady,
  settings,
  folder,
  tabs,
  activePath,
  setFolder,
  restoreSession,
  persistSettings,
}: Options): boolean {
  const didRestore = useRef(false)
  const [restored, setRestored] = useState(false)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    if (!settingsReady || didRestore.current || !settings) return
    didRestore.current = true
    void (async () => {
      try {
        if (settings.session?.folder) {
          try {
            const result = await desktop.openFolderPath(settings.session.folder)
            if (result) setFolder(result)
          } catch (error) {
            // A missing or no-longer-authorized folder must not prevent the
            // independently stored files from being restored below.
            console.error('Session folder restore failed', error)
          }
        }
        if (settings.session?.openFiles?.length) {
          try {
            await restoreSession(settings.session.openFiles, settings.session.activePath)
          } catch (error) {
            console.error('Session file restore failed', error)
          }
        }
      } finally {
        // Persistence stays disabled until every asynchronous read finishes;
        // otherwise a cold start can erase the saved session with an empty one.
        setRestored(true)
      }
    })()
  }, [restoreSession, setFolder, settings, settingsReady])

  const tabPathsKey = tabs.map((tab) => tab.path ?? '').join('\0')
  useEffect(() => {
    if (!restored) return
    const session = workspaceSessionSnapshot(folder?.root ?? null, tabsRef.current, activePath)
    const timer = window.setTimeout(() => {
      persistSettings({ session }, 'Session persistence failed')
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activePath, folder?.root, persistSettings, restored, tabPathsKey])

  return restored
}
