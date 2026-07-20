import { useCallback, useEffect, useRef, useState } from 'react'
import { updater } from '../platform'
import type { AvailableUpdate, ReleaseSummary, UpdateDownloadEvent } from '../platform/contracts'

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

export type ReleaseListPhase = 'idle' | 'loading' | 'loaded' | 'error'

export interface ReleaseListState {
  phase: ReleaseListPhase
  items: ReleaseSummary[]
  error?: string
}

export type ReleaseInstallPhase = 'idle' | 'checking' | 'downloading' | 'error'

export interface ReleaseInstallState {
  phase: ReleaseInstallPhase
  /** The release tag currently being checked/installed. */
  tag?: string
  version?: string
  progress?: number
  error?: string
}

export interface UpdaterController {
  state: UpdateState
  checkNow: (manual?: boolean) => Promise<void>
  install: () => Promise<void>
  dismiss: () => void
  /** GitHub releases available to install — the source of the rollback picker in Settings. */
  releases: ReleaseListState
  loadReleases: () => Promise<void>
  releaseInstall: ReleaseInstallState
  /** Downloads and installs one specific release tag, then relaunches. */
  installRelease: (tag: string) => Promise<void>
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

  const loadingReleasesRef = useRef(false)
  const [releases, setReleases] = useState<ReleaseListState>({ phase: 'idle', items: [] })

  const loadReleases = useCallback(async () => {
    if (loadingReleasesRef.current) return
    loadingReleasesRef.current = true
    setReleases((previous) => ({ ...previous, phase: 'loading' }))
    try {
      // Never cached: the operator can delete a GitHub release at any time,
      // so a stale local list could offer a version that no longer downloads.
      const items = await updater.listReleases()
      setReleases({ phase: 'loaded', items })
    } catch (error) {
      setReleases({
        phase: 'error',
        items: [],
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      loadingReleasesRef.current = false
    }
  }, [])

  const releaseInstallingRef = useRef(false)
  const releaseUpdateRef = useRef<AvailableUpdate | null>(null)
  const [releaseInstall, setReleaseInstall] = useState<ReleaseInstallState>({ phase: 'idle' })

  const installRelease = useCallback(async (tag: string) => {
    if (releaseInstallingRef.current) return
    releaseInstallingRef.current = true
    setReleaseInstall({ phase: 'checking', tag })
    try {
      const update = await updater.checkRelease(tag)
      if (!update) throw new Error('No downloadable package found for this release')
      releaseUpdateRef.current = update
      setReleaseInstall({ phase: 'downloading', tag, version: update.version, progress: 0 })
      let downloaded = 0
      let total = 0
      await update.downloadAndInstall((event: UpdateDownloadEvent) => {
        if (event.event === 'Started') {
          total = event.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.chunkLength
          setReleaseInstall((previous) => ({
            ...previous,
            progress: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
          }))
        } else {
          setReleaseInstall((previous) => ({ ...previous, progress: 100 }))
        }
      })
      await updater.relaunch()
    } catch (error) {
      setReleaseInstall({
        phase: 'error',
        tag,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      releaseInstallingRef.current = false
      const update = releaseUpdateRef.current
      releaseUpdateRef.current = null
      if (update) void update.close().catch(() => undefined)
    }
  }, [])

  useEffect(
    () => () => {
      const update = releaseUpdateRef.current
      releaseUpdateRef.current = null
      if (update) void update.close().catch(() => undefined)
    },
    [],
  )

  return {
    state,
    checkNow,
    install,
    dismiss,
    releases,
    loadReleases,
    releaseInstall,
    installRelease,
  }
}
