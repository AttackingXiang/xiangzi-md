import { useEffect, useMemo, useRef } from 'react'
import { desktop } from '../platform'
import { dirName } from '../lib/path'
import type { Tab } from '../types'

interface Options {
  tabs: Tab[]
  activeId: string | null
  checkPaths: (paths?: readonly string[]) => Promise<void>
}

const WATCH_DELAY_MS = 350
const FOCUS_THROTTLE_MS = 5_000

function uniqueOpenPaths(tabs: readonly Tab[]): string[] {
  return [...new Set(tabs.flatMap((tab) => (tab.path ? [tab.path] : [])))].sort()
}

/**
 * Uses native events as hints and delegates every decision to a hash-verified disk read.
 * Parent directories catch atomic temp-file replacements; exact-file watching is the
 * fallback for a single file whose picker scope does not include its parent directory.
 */
export function useExternalFileWatcher({ tabs, activeId, checkPaths }: Options): void {
  const watchKey = useMemo(() => uniqueOpenPaths(tabs).join('\0'), [tabs])
  const activePath = tabs.find((tab) => tab.id === activeId)?.path ?? null
  const pathsRef = useRef<string[]>([])
  pathsRef.current = uniqueOpenPaths(tabs)

  useEffect(() => {
    const paths = watchKey ? watchKey.split('\0') : []
    if (paths.length === 0) return undefined

    const groups = new Map<string, string[]>()
    for (const path of paths) {
      const parent = dirName(path)
      if (!parent) continue
      const group = groups.get(parent) ?? []
      group.push(path)
      groups.set(parent, group)
    }

    let disposed = false
    const stops: Array<() => void> = []
    const start = async (parent: string, filePaths: string[]): Promise<void> => {
      const onChange = (): void => void checkPaths(filePaths)
      try {
        const stop = await desktop.watchPaths([parent], onChange, {
          recursive: false,
          delayMs: WATCH_DELAY_MS,
        })
        if (disposed) stop()
        else stops.push(stop)
      } catch {
        try {
          const stop = await desktop.watchPaths(filePaths, onChange, {
            recursive: false,
            delayMs: WATCH_DELAY_MS,
          })
          if (disposed) stop()
          else stops.push(stop)
        } catch {
          // Focus and tab-activation checks below remain the reliable fallback.
        }
      }
    }

    for (const [parent, filePaths] of groups) void start(parent, filePaths)
    return () => {
      disposed = true
      for (const stop of stops) stop()
    }
  }, [checkPaths, watchKey])

  const lastFocusCheckRef = useRef(0)
  useEffect(() => {
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocusCheckRef.current < FOCUS_THROTTLE_MS) return
      lastFocusCheckRef.current = now
      void checkPaths(pathsRef.current)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkPaths])

  useEffect(() => {
    if (activePath) void checkPaths([activePath])
  }, [activePath, checkPaths])
}
