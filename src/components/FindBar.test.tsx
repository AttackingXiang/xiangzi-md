// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import FindBar from './FindBar'

function renderFindBar(focusRequest: number): { host: HTMLElement; root: Root } {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(<FindBar focusRequest={focusRequest} onClose={() => undefined} />)
  })
  return { host, root }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('FindBar', () => {
  it('returns focus to the find input when the global find command repeats', () => {
    const { host, root } = renderFindBar(0)
    const input = host.querySelector<HTMLInputElement>('.find-input')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)

    input?.blur()
    expect(document.activeElement).not.toBe(input)

    act(() => {
      root.render(<FindBar focusRequest={1} onClose={() => undefined} />)
    })
    expect(document.activeElement).toBe(input)

    act(() => root.unmount())
  })
})
