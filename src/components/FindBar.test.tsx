// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as searchBridge from '../lib/searchBridge'
import FindBar from './FindBar'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
    input,
  )
  setter?.(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

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
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('FindBar', () => {
  it('closes with Escape from a navigation button', () => {
    const onClose = vi.fn()
    const { host, root } = renderFindBar(0)
    act(() => root.render(<FindBar onClose={onClose} />))
    act(() => {
      host
        .querySelector('button[title^="下一个"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it('refreshes the hint after replacing all matches without navigating again', () => {
    vi.spyOn(searchBridge, 'hasEditor').mockReturnValue(true)
    vi.spyOn(searchBridge, 'canReplaceInEditor').mockReturnValue(true)
    const search = vi.spyOn(searchBridge, 'searchFind').mockReturnValue('at-end')
    vi.spyOn(searchBridge, 'searchReplaceAll').mockReturnValue(true)
    vi.spyOn(searchBridge, 'searchStatus').mockReturnValue('not-found')
    const { host, root } = renderFindBar(0)
    act(() => typeInto(host.querySelector<HTMLInputElement>('.find-input')!, 'target'))
    act(() => host.querySelector<HTMLButtonElement>('button[title="替换"]')?.click())
    act(() => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent === '全部替换')
        ?.click()
    })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('没有找到匹配的内容。')
    expect(search).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

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

  it('announces when the query has no matches', () => {
    vi.spyOn(searchBridge, 'hasEditor').mockReturnValue(true)
    vi.spyOn(searchBridge, 'searchFind').mockReturnValue('not-found')
    const { host, root } = renderFindBar(0)
    const input = host.querySelector<HTMLInputElement>('.find-input')!

    act(() => {
      typeInto(input, 'missing')
    })

    expect(host.querySelector('[role="status"]')?.textContent).toBe('没有找到匹配的内容。')
    act(() => root.unmount())
  })

  it('announces forward and backward wrap boundaries', () => {
    vi.spyOn(searchBridge, 'searchNext').mockReturnValue('at-end')
    vi.spyOn(searchBridge, 'searchPrev').mockReturnValue('at-start')
    const { host, root } = renderFindBar(0)
    const input = host.querySelector<HTMLInputElement>('.find-input')!
    act(() => {
      typeInto(input, 'target')
    })

    act(() => host.querySelector<HTMLButtonElement>('button[title^="下一个"]')?.click())
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '已到文档底部，再次查找将从头开始。',
    )

    act(() => host.querySelector<HTMLButtonElement>('button[title^="上一个"]')?.click())
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '已到文档顶部，再次查找将从末尾开始。',
    )
    act(() => root.unmount())
  })
})
