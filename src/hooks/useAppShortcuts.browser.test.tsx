// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldOpenFolderSearchFromTarget, useAppShortcuts } from './useAppShortcuts'
import type { ShortcutAction } from '../lib/shortcuts'
import { resetModalStack } from '../lib/modalStack'
import { useModalFocus } from './useModalFocus'

function Fixture({ dispatch }: { dispatch: (action: ShortcutAction) => void }): JSX.Element {
  useAppShortcuts({}, dispatch)
  return createElement('input', { defaultValue: 'search text' })
}

function ModalFixture({ dispatch }: { dispatch: (action: ShortcutAction) => void }): JSX.Element {
  useAppShortcuts({}, dispatch)
  const ref = useModalFocus<HTMLDivElement>()
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <input defaultValue="dialog text" />
    </div>
  )
}

function renderFixture(dispatch: (action: ShortcutAction) => void): {
  host: HTMLElement
  root: Root
} {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<Fixture dispatch={dispatch} />))
  return { host, root }
}

afterEach(() => {
  document.body.replaceChildren()
  resetModalStack()
})

describe('application select-all shortcut routing', () => {
  it('recognizes the file tree as the folder-search context', () => {
    const sidebar = document.createElement('div')
    sidebar.className = 'sidebar-wrap'
    const row = document.createElement('div')
    sidebar.append(row)
    document.body.append(sidebar)

    expect(shouldOpenFolderSearchFromTarget(row)).toBe(true)
  })

  it('selects the active input even when the window key event target is not the input', () => {
    const dispatch = vi.fn()
    const { host, root } = renderFixture(dispatch)
    const input = host.querySelector<HTMLInputElement>('input')
    expect(input).not.toBeNull()
    input?.focus()
    input?.setSelectionRange(0, 0)

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe(input?.value.length)
    expect(event.defaultPrevented).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()

    act(() => root.unmount())
  })

  it('blocks application shortcuts while a modal owns focus', () => {
    const dispatch = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<ModalFixture dispatch={dispatch} />))

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      code: 'KeyN',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('keeps native select-all working in a modal text field', () => {
    const dispatch = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<ModalFixture dispatch={dispatch} />))
    const input = host.querySelector('input')
    input?.focus()
    input?.setSelectionRange(0, 0)

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(input?.selectionEnd).toBe(input?.value.length)
    expect(dispatch).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})
