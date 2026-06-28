import { useCallback, useEffect, useRef, useState } from 'react'
import { updater } from '../platform'
import type { AvailableUpdate, UpdateDownloadEvent } from '../platform/contracts'

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  version?: string
  currentVersion?: string
  notes?: string
  source?: 'github' | 'gitee'
  progress?: number
  error?: string
  checkedAt?: number
}

export interface UpdaterController {
  state: UpdateState
  checkNow: (manual?: boolean) => Promise<void>
  install: () => Promise<void>
  dismiss: () => void
}

export function useUpdater(checkOnStartup: boolean): UpdaterController {
  const updateRef = useRef<AvailableUpdate | null>(null)
  const checkingRef = useRef(false)
  const autoCheckedRef = useRef(false)
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  const disposeUpdate = useCallback(() => {
    const update = updateRef.current
    updateRef.current = null
    if (update) void update.close().catch(() => undefined)
  }, [])

  const checkNow = useCallback(
    async (manual = true) => {
      if (checkingRef.current) return
      checkingRef.current = true
      setState({ phase: 'checking' })
      disposeUpdate()
      try {
        // The configured endpoint order is GitHub first, then Gitee. The
        // official updater walks the list on transport, status, or JSON errors.
        const update = await updater.check(8_000)
        if (!update) {
          setState({ phase: 'up-to-date', checkedAt: Date.now() })
          return
        }
        updateRef.current = update
        setState({
          phase: 'available',
          version: update.version,
          currentVersion: update.currentVersion,
          notes: update.notes,
          source: update.source,
          checkedAt: Date.now(),
        })
      } catch (error) {
        setState({
          phase: 'error',
          error: manual ? (error instanceof Error ? error.message : String(error)) : undefined,
          checkedAt: Date.now(),
        })
      } finally {
        checkingRef.current = false
      }
    },
    [disposeUpdate],
  )

  const install = useCallback(async () => {
    const update = updateRef.current
    if (!update) return
    let downloaded = 0
    let total = 0
    setState((previous) => ({ ...previous, phase: 'downloading', progress: 0 }))
    try {
      await update.downloadAndInstall((event: UpdateDownloadEvent) => {
        if (event.event === 'Started') {
          total = event.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.chunkLength
          setState((previous) => ({
            ...previous,
            progress: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
          }))
        } else if (event.event === 'Finished') {
          setState((previous) => ({ ...previous, progress: 100 }))
        }
      })
      await updater.relaunch()
    } catch (error) {
      setState((previous) => ({
        ...previous,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [])

  const dismiss = useCallback(() => {
    disposeUpdate()
    setState({ phase: 'idle' })
  }, [disposeUpdate])

  useEffect(() => {
    if (!checkOnStartup || autoCheckedRef.current) return
    autoCheckedRef.current = true
    const timer = window.setTimeout(() => void checkNow(false), 1_500)
    return () => window.clearTimeout(timer)
  }, [checkNow, checkOnStartup])

  useEffect(() => disposeUpdate, [disposeUpdate])

  return { state, checkNow, install, dismiss }
}
