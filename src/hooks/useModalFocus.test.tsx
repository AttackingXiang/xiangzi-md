// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useModalFocus } from './useModalFocus'

function Fixture(): JSX.Element {
  const ref = useModalFocus<HTMLElement>()
  return (
    <section ref={ref} tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">last</button>
    </section>
  )
}

afterEach(() => {
  document.body.replaceChildren()
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
})
