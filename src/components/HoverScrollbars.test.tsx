// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HoverScrollbars from './HoverScrollbars'

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe('HoverScrollbars interaction lifecycle', () => {
  let host: HTMLElement
  let target: HTMLElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    host = document.createElement('div')
    target = document.createElement('div')
    document.body.append(host, target)
    Object.defineProperties(target, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 800 },
    })
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  async function renderScrollbar(
    onInteractionStart: () => void,
    onInteractionEnd: () => void,
  ): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <HoverScrollbars
          targetRef={{ current: target }}
          axes="vertical"
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
        />,
      )
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    const thumb = host.querySelector<HTMLElement>('.hover-scrollbar-thumb')
    if (!thumb) throw new Error('expected vertical scrollbar thumb')
    return thumb
  }

  it('finishes a thumb drag when pointer capture is lost', async () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    const thumb = await renderScrollbar(onStart, onEnd)
    thumb.setPointerCapture = vi.fn()

    act(() => {
      thumb.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 7,
        }),
      )
      thumb.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    })

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('wraps a track jump in one complete interaction', async () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    const thumb = await renderScrollbar(onStart, onEnd)
    const track = thumb.parentElement
    if (!track) throw new Error('expected scrollbar track')
    track.getBoundingClientRect = () =>
      ({ top: 0, right: 8, bottom: 200, left: 0, width: 8, height: 200, x: 0, y: 0 }) as DOMRect

    act(() => {
      track.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientY: 150,
        }),
      )
    })

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(target.scrollTop).toBe(450)
  })
})
