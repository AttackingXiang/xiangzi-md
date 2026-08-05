// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installWebViewChrome } from './webviewChrome'

const triggerMenuAction = vi.hoisted(() => vi.fn())
vi.mock('../platform', () => ({ desktop: { triggerMenuAction } }))

let uninstall: (() => void) | null = null

function install(): void {
  uninstall = installWebViewChrome()
}

afterEach(() => {
  uninstall?.()
  uninstall = null
  document.body.replaceChildren()
  vi.resetAllMocks()
})

function dispatch(target: EventTarget, event: Event): Event {
  target.dispatchEvent(event)
  return event
}

/**
 * happy-dom 的 WheelEvent 构造函数会丢掉 ctrlKey（deltaY 正常），
 * 所以修饰键在这里手动补上。
 */
function wheelEvent(deltaY: number, { ctrlKey = false } = {}): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY })
  Object.defineProperty(event, 'ctrlKey', { value: ctrlKey })
  return event
}

describe('installWebViewChrome', () => {
  it('suppresses the native context menu outside text fields', () => {
    install()
    const event = dispatch(
      document.body,
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps the native context menu inside inputs, where it is actually useful', () => {
    install()
    const input = document.createElement('input')
    document.body.append(input)
    const event = dispatch(
      input,
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    expect(event.defaultPrevented).toBe(false)
  })

  it('routes ctrl+wheel to the app zoom instead of letting the WebView scale', () => {
    install()
    const event = dispatch(document.body, wheelEvent(120, { ctrlKey: true }))

    expect(event.defaultPrevented).toBe(true)
    expect(triggerMenuAction).toHaveBeenCalledWith('zoom-out')
    expect(triggerMenuAction).toHaveBeenCalledTimes(2) // 120 / 60
  })

  it('accumulates small trackpad deltas rather than zooming on every event', () => {
    install()
    for (let i = 0; i < 3; i += 1) {
      dispatch(document.body, wheelEvent(-25, { ctrlKey: true }))
    }
    expect(triggerMenuAction).toHaveBeenCalledOnce()
    expect(triggerMenuAction).toHaveBeenCalledWith('zoom-in')
  })

  it('leaves plain wheel scrolling alone', () => {
    install()
    const event = dispatch(document.body, wheelEvent(120))
    expect(event.defaultPrevented).toBe(false)
    expect(triggerMenuAction).not.toHaveBeenCalled()
  })

  it('blocks stray file drops that would navigate the WebView away', () => {
    install()
    const event = dispatch(document.body, new Event('drop', { bubbles: true, cancelable: true }))
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets the editor keep its own drag and drop', () => {
    install()
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    editor.append(content)
    document.body.append(editor)

    expect(
      dispatch(content, new Event('dragover', { bubbles: true, cancelable: true }))
        .defaultPrevented,
    ).toBe(false)
    expect(
      dispatch(content, new Event('drop', { bubbles: true, cancelable: true })).defaultPrevented,
    ).toBe(false)
  })
})
