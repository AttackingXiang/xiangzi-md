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
})
