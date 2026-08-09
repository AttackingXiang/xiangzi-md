// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPreviewSettings } from '../../platform/browserAdapter'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const desktop = vi.hoisted(() => ({
  pickFolder: vi.fn(),
  authorizeAssetSearchDirectory: vi.fn(),
}))
vi.mock('../../platform', () => ({ desktop }))

import AttachmentsSection from './AttachmentsSection'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  desktop.pickFolder.mockResolvedValue({ path: '/images' })
  desktop.authorizeAssetSearchDirectory.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function chooseFolder(onChange = vi.fn()): Promise<typeof onChange> {
  act(() =>
    root.render(
      <AttachmentsSection
        settings={createBrowserPreviewSettings()}
        onChange={onChange}
        en={false}
      />,
    ),
  )
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('选择文件夹'))
      ?.click()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  return onChange
}

describe('AttachmentsSection asset folder authorization', () => {
  it('persists a folder only after the native scope authorizes it', async () => {
    const onChange = await chooseFolder()
    expect(desktop.authorizeAssetSearchDirectory).toHaveBeenCalledWith('/images')
    expect(onChange).toHaveBeenCalledWith({ assetSearchPaths: ['/images'] })
  })

  it('shows an error and does not persist an unauthorized path', async () => {
    desktop.authorizeAssetSearchDirectory.mockRejectedValue(new Error('denied'))
    const onChange = await chooseFolder()
    expect(onChange).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法授权')
  })

  it('shows the same recoverable error when the native folder picker fails', async () => {
    desktop.pickFolder.mockRejectedValue(new Error('picker unavailable'))
    const onChange = await chooseFolder()
    expect(desktop.authorizeAssetSearchDirectory).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法授权')
  })
})
