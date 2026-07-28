// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPreviewSettings } from '../../platform/browserAdapter'
import type { InstalledTheme } from '../../platform/contracts'

const desktop = vi.hoisted(() => ({
  listInstalledThemes: vi.fn(),
  openExternal: vi.fn(),
  pickCss: vi.fn(),
  pickImage: vi.fn(),
  removeInstalledTheme: vi.fn(),
}))

vi.mock('../../platform', () => ({ desktop }))

import AppearanceSection from './AppearanceSection'

const installedTheme: InstalledTheme = {
  id: 'morandi-light',
  name: 'Morandi',
  version: '1.0.0',
  author: 'Xiangzi',
  colorScheme: 'light',
  cssPath: '/themes/morandi-light.css',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  desktop.listInstalledThemes.mockResolvedValue([])
  desktop.openExternal.mockResolvedValue(undefined)
  desktop.removeInstalledTheme.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

async function render(customCssPath = '', onChange = vi.fn()): Promise<void> {
  const settings = { ...createBrowserPreviewSettings(), customCssPath }
  await act(async () => {
    root.render(
      <AppearanceSection
        settings={settings}
        onChange={onChange}
        en={false}
        customCssError={false}
        backgroundImageError={false}
      />,
    )
    await Promise.resolve()
  })
}

describe('AppearanceSection theme actions', () => {
  it('opens the theme gallery only from the More themes button', async () => {
    await render()

    expect(
      Array.from(host.querySelectorAll('.settings-card > h3')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['界面', '主题', '阅读细节', '背景与自定义'])

    const row = host.querySelector('.settings-theme-gallery-row')
    const moreThemes = host.querySelector<HTMLButtonElement>('.settings-more-themes')
    expect(row?.tagName).toBe('DIV')
    expect(moreThemes).not.toBeNull()

    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(desktop.openExternal).not.toHaveBeenCalled()

    act(() => moreThemes?.click())
    expect(desktop.openExternal).toHaveBeenCalledWith('https://xz.xzfast.top/themes')
  })

  it('lists every local theme and deletes the selected item', async () => {
    const darkTheme: InstalledTheme = {
      ...installedTheme,
      id: 'midnight',
      name: 'Midnight',
      colorScheme: 'dark',
      cssPath: '/themes/midnight.css',
    }
    desktop.listInstalledThemes.mockResolvedValue([installedTheme, darkTheme])
    const onChange = vi.fn()
    await render(installedTheme.cssPath, onChange)

    act(() => host.querySelector<HTMLButtonElement>('.settings-manage-themes')?.click())
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Morandi')
    expect(dialog?.textContent).toContain('Midnight')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-theme-id="morandi-light"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(desktop.removeInstalledTheme).toHaveBeenCalledWith('morandi-light')
    expect(onChange).toHaveBeenCalledWith({ theme: 'light', customCssPath: '' })
    expect(dialog?.textContent).not.toContain('Morandi')
    expect(dialog?.textContent).toContain('Midnight')
  })
})
