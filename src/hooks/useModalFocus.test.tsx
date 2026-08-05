// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalFocus } from './useModalFocus'
import { resetModalStack } from '../lib/modalStack'

function Fixture(): JSX.Element {
  const ref = useModalFocus<HTMLElement>()
  return (
    <section ref={ref} tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">last</button>
    </section>
  )
}

function NestingFixture({
  childOpen,
  onCloseParent,
  onCloseChild,
}: {
  childOpen: boolean
  onCloseParent: () => void
  onCloseChild: () => void
}): JSX.Element {
  const parentRef = useModalFocus<HTMLElement>(true, onCloseParent)
  const childRef = useModalFocus<HTMLElement>(childOpen, onCloseChild)
  return (
    <section ref={parentRef} tabIndex={-1} aria-modal="true">
      <button type="button">parent</button>
      {childOpen && (
        <div ref={childRef as never} tabIndex={-1} aria-modal="true">
          <button type="button">child</button>
        </div>
      )}
    </section>
  )
}

function pressEscape(): void {
  // 焦点回到 body 是 Tauri WebView 里子弹窗刚关闭后的常态；模态栈必须在这种
  // "从 event.target 往上找不到任何 aria-modal" 的情况下依然分发正确。
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

afterEach(() => {
  document.body.replaceChildren()
  resetModalStack()
})

describe('useModalFocus', () => {
  it('focuses the dialog, traps Tab, and restores the previous focus', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<Fixture />))
    const [first, last] = Array.from(host.querySelectorAll('button'))
    expect(document.activeElement).toBe(first)

    last.focus()
    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(first)

    first.focus()
    act(() => {
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(last)

    act(() => root.unmount())
    expect(document.activeElement).toBe(opener)
  })

  it('gives Escape to the innermost modal even when focus is on the body', () => {
    const onCloseParent = vi.fn()
    const onCloseChild = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        <NestingFixture childOpen onCloseParent={onCloseParent} onCloseChild={onCloseChild} />,
      ),
    )
    document.body.focus()

    act(() => pressEscape())
    expect(onCloseChild).toHaveBeenCalledOnce()
    expect(onCloseParent).not.toHaveBeenCalled()

    // 子弹窗关掉后，Escape 才轮到父弹窗。
    act(() =>
      root.render(
        <NestingFixture
          childOpen={false}
          onCloseParent={onCloseParent}
          onCloseChild={onCloseChild}
        />,
      ),
    )
    act(() => pressEscape())
    expect(onCloseParent).toHaveBeenCalledOnce()

    act(() => root.unmount())
  })
})
