// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPreviewSettings } from '../platform/browserAdapter'
import type { AppSettings } from '../types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const desktop = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  authorizeAssetSearchDirectory: vi.fn(),
}))
vi.mock('../platform', () => ({ desktop }))

import { useSettings } from './useSettings'

type Controller = ReturnType<typeof useSettings>
let controller: Controller | null = null
let host: HTMLDivElement
let root: Root

function captureController(value: Controller): void {
  controller = value
}

function Fixture(): null {
  const value = useSettings()
  useEffect(() => captureController(value), [value])
  return null
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(async () => {
  const base = createBrowserPreviewSettings()
  desktop.getSettings.mockResolvedValue(base)
  desktop.authorizeAssetSearchDirectory.mockResolvedValue(undefined)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<Fixture />)
    await Promise.resolve()
  })
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  controller = null
  vi.clearAllMocks()
})

describe('useSettings favorites follow the file system', () => {
  async function seedFavorites(): Promise<void> {
    // 每次写盘的响应都是权威值、会整份合并回状态，所以 mock 要像真实后端那样把
    // 补丁累积起来——否则后一次写入的响应会把前一次收藏的结果抹掉。
    let stored = createBrowserPreviewSettings()
    desktop.setSettings.mockImplementation((patch: Partial<AppSettings>) => {
      stored = { ...stored, ...patch }
      return Promise.resolve(stored)
    })
    await act(async () => {
      controller!.toggleFavorite('/vault/notes')
      await Promise.resolve()
    })
    await act(async () => {
      controller!.toggleFavorite('/vault/notes/todo.md', true)
      await Promise.resolve()
    })
    await act(async () => {
      controller!.setFavoriteLabel('/vault/notes', '工作')
      await Promise.resolve()
    })
    await act(async () => {
      controller!.togglePinnedFolder('/vault/notes')
      await Promise.resolve()
    })
  }

  it('remaps favorites, labels and pinned folders when a folder is renamed', async () => {
    await seedFavorites()

    await act(async () => {
      controller!.recordDocRename('/vault/notes', '/vault/archive')
      await Promise.resolve()
    })

    expect(controller?.settings?.favorites).toEqual(['/vault/archive', '/vault/archive/todo.md'])
    expect(controller?.settings?.favoriteFiles).toEqual(['/vault/archive/todo.md'])
    expect(controller?.settings?.favoriteLabels).toEqual({ '/vault/archive': '工作' })
    expect(controller?.settings?.pinnedFolders).toEqual(['/vault/archive'])
  })

  it('drops favorites, labels and pinned folders under a deleted folder', async () => {
    await seedFavorites()

    await act(async () => {
      controller!.recordDocRemove('/vault/notes')
      await Promise.resolve()
    })

    expect(controller?.settings?.favorites).toEqual([])
    expect(controller?.settings?.favoriteFiles).toEqual([])
    expect(controller?.settings?.favoriteLabels).toEqual({})
    expect(controller?.settings?.pinnedFolders).toEqual([])
  })

  it('leaves unrelated favorites alone', async () => {
    await seedFavorites()

    await act(async () => {
      controller!.recordDocRename('/vault/other', '/vault/moved')
      await Promise.resolve()
    })

    expect(controller?.settings?.favorites).toEqual(['/vault/notes', '/vault/notes/todo.md'])
  })
})

describe('useSettings persistence coordination', () => {
  it('keeps newer optimistic values while an older persisted response completes', async () => {
    const base = createBrowserPreviewSettings()
    const first = deferred<AppSettings>()
    const second = deferred<AppSettings>()
    desktop.setSettings.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    let widthSave!: Promise<AppSettings>
    await act(async () => {
      widthSave = controller!.saveSettings({ editorWidth: 'wide' })
      await Promise.resolve()
    })
    let toolbarSave!: Promise<AppSettings>
    act(() => {
      toolbarSave = controller!.saveSettings({ showToolbar: false })
    })

    expect(controller?.settings?.editorWidth).toBe('wide')
    expect(controller?.settings?.showToolbar).toBe(false)
    expect(desktop.setSettings).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve({ ...base, editorWidth: 'wide' })
      await widthSave
    })
    expect(controller?.settings?.showToolbar).toBe(false)
    expect(desktop.setSettings).toHaveBeenLastCalledWith({ showToolbar: false })

    await act(async () => {
      second.resolve({ ...base, editorWidth: 'wide', showToolbar: false })
      await toolbarSave
    })
    expect(controller?.settings?.editorWidth).toBe('wide')
    expect(controller?.settings?.showToolbar).toBe(false)
    expect(controller?.settingsSaving).toBe(false)
  })

  it('restores persisted settings and exposes an inline error after the latest write fails', async () => {
    const base = createBrowserPreviewSettings()
    desktop.setSettings.mockRejectedValueOnce(new Error('disk full'))
    desktop.getSettings.mockResolvedValue(base)

    await act(async () => {
      await expect(controller!.saveSettings({ editorWidth: 'normal' })).rejects.toThrow('disk full')
    })

    expect(controller?.settings?.editorWidth).toBe(base.editorWidth)
    expect(controller?.settingsSaveError).toBe(true)
    expect(controller?.settingsSaving).toBe(false)
  })

  it('does not reauthorize unchanged asset paths after unrelated settings writes', async () => {
    const base = createBrowserPreviewSettings()
    const withAssetPath = { ...base, assetSearchPaths: ['/images'] }
    desktop.setSettings
      .mockResolvedValueOnce(withAssetPath)
      .mockResolvedValueOnce({ ...withAssetPath, showToolbar: false })

    await act(async () => {
      await controller!.saveSettings({ assetSearchPaths: ['/images'] })
    })
    expect(desktop.authorizeAssetSearchDirectory).toHaveBeenCalledTimes(1)
    expect(desktop.authorizeAssetSearchDirectory).toHaveBeenCalledWith('/images')

    await act(async () => {
      await controller!.saveSettings({ showToolbar: false })
    })
    expect(desktop.authorizeAssetSearchDirectory).toHaveBeenCalledTimes(1)
  })
})
