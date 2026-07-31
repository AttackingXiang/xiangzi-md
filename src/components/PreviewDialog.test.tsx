// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PreviewDialog from './PreviewDialog'

function renderPreview(onClose = vi.fn()): { host: HTMLElement; root: Root } {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <PreviewDialog
        title="图片预览"
        onClose={onClose}
        minScale={0.05}
        maxScale={6}
        initialTool="pan"
        baseSize={{ width: 1200, height: 800 }}
      >
        <div style={{ width: 1200, height: 800 }} />
      </PreviewDialog>,
    )
  })
  return { host, root }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('PreviewDialog', () => {
  it('lets the user switch tools and maximize only the preview panel', () => {
    const { host, root } = renderPreview()
    const hand = host.querySelector<HTMLButtonElement>('[title="抓手工具"]')
    const select = host.querySelector<HTMLButtonElement>('[title="选择工具"]')
    const maximize = host.querySelector<HTMLButtonElement>('[title="最大化预览窗口"]')

    expect(hand?.getAttribute('aria-pressed')).toBe('true')
    act(() => select?.click())
    expect(select?.getAttribute('aria-pressed')).toBe('true')

    act(() => maximize?.click())
    expect(host.querySelector('.preview-backdrop')?.classList.contains('is-maximized')).toBe(true)
    expect(host.querySelector('[title="还原预览窗口"]')).not.toBeNull()

    act(() => root.unmount())
  })

  it('uses Escape to restore a maximized preview before closing it', () => {
    const onClose = vi.fn()
    const { host, root } = renderPreview(onClose)
    act(() => host.querySelector<HTMLButtonElement>('[title="最大化预览窗口"]')?.click())

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('.preview-backdrop')?.classList.contains('is-maximized')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledOnce()

    act(() => root.unmount())
  })
})
