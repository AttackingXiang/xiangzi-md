// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPreviewSettings } from '../platform/browserAdapter'
import type { AppSettings, Folder, Tab } from '../types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const desktop = vi.hoisted(() => ({ openFolderPath: vi.fn() }))
vi.mock('../platform', () => ({ desktop }))

import { useWorkspaceSession, workspaceSessionSnapshot } from './useWorkspaceSession'

function tab(id: string, path: string | null): Tab {
  return {
    id,
    path,
    name: id,
    content: '',
    savedContent: '',
    dirty: false,
    revision: 0,
    version: null,
  }
}

let root: Root
let host: HTMLDivElement
let restored = false

interface FixtureProps {
  settings: AppSettings
  tabs: Tab[]
  restoreSession: (openFiles: string[], activePath: string | null) => Promise<void>
  persistSettings: (patch: Partial<AppSettings>, context: string) => void
  onRestored: (value: boolean) => void
}

function Fixture({
  settings,
  tabs,
  restoreSession,
  persistSettings,
  onRestored,
}: FixtureProps): null {
  const [folder, setFolder] = useState<Folder | null>(null)
  const value = useWorkspaceSession({
    settingsReady: true,
    settings,
    folder,
    tabs,
    activePath: tabs[0]?.path ?? null,
    setFolder,
    restoreSession,
    persistSettings,
  })
  useEffect(() => onRestored(value), [onRestored, value])
  return null
}

function captureRestored(value: boolean): void {
  restored = value
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  restored = false
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('workspaceSessionSnapshot', () => {
  it('persists only disk-backed tabs and the current active path', () => {
    expect(
      workspaceSessionSnapshot(
        '/notes',
        [tab('a', '/notes/a.md'), tab('new', null)],
        '/notes/a.md',
      ),
    ).toEqual({
      folder: '/notes',
      openFiles: ['/notes/a.md'],
      activePath: '/notes/a.md',
    })
  })
})

describe('useWorkspaceSession', () => {
  it('does not persist an empty startup snapshot before asynchronous restoration finishes', async () => {
    const pendingRestore = deferred()
    const restoreSession = vi.fn().mockReturnValue(pendingRestore.promise)
    const persistSettings = vi.fn()
    const settings: AppSettings = {
      ...createBrowserPreviewSettings(),
      session: {
        folder: '/notes',
        openFiles: ['/notes/a.md'],
        activePath: '/notes/a.md',
      },
    }
    desktop.openFolderPath.mockResolvedValue({ root: '/notes', name: 'notes', tree: [] })

    await act(async () => {
      root.render(
        createElement(Fixture, {
          settings,
          tabs: [tab('a', '/notes/a.md')],
          restoreSession,
          persistSettings,
          onRestored: captureRestored,
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(restoreSession).toHaveBeenCalledWith(['/notes/a.md'], '/notes/a.md')
    expect(restored).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(persistSettings).not.toHaveBeenCalled()

    await act(async () => {
      pendingRestore.resolve()
      await pendingRestore.promise
    })
    expect(restored).toBe(true)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(persistSettings).toHaveBeenCalledWith(
      {
        session: {
          folder: '/notes',
          openFiles: ['/notes/a.md'],
          activePath: '/notes/a.md',
        },
      },
      'Session persistence failed',
    )
  })

  it('still restores files when the saved folder can no longer be reopened', async () => {
    const restoreSession = vi.fn().mockResolvedValue(undefined)
    const settings: AppSettings = {
      ...createBrowserPreviewSettings(),
      session: {
        folder: '/missing',
        openFiles: ['/notes/a.md'],
        activePath: '/notes/a.md',
      },
    }
    desktop.openFolderPath.mockRejectedValue(new Error('missing folder'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await act(async () => {
      root.render(
        createElement(Fixture, {
          settings,
          tabs: [],
          restoreSession,
          persistSettings: vi.fn(),
          onRestored: captureRestored,
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(restoreSession).toHaveBeenCalledWith(['/notes/a.md'], '/notes/a.md')
    expect(restored).toBe(true)
  })
})
