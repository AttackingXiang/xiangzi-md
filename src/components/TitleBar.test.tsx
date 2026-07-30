// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import TitleBar from './TitleBar'

function renderTitleBar(props: { documentName?: string; dirty?: boolean } = {}): HTMLElement {
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<TitleBar {...props} />))
  return host
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('TitleBar', () => {
  it('shows only the document name in the centered title when a document is open', () => {
    const host = renderTitleBar({ documentName: 'notes.md', dirty: true })

    expect(host.querySelector('.titlebar-title')?.textContent).toBe('notes.md')
    expect(host.querySelector('.titlebar-dirty')).not.toBeNull()
  })

  it('shows the app name in the centered title when no document is open', () => {
    const host = renderTitleBar()

    expect(host.querySelector('.titlebar-title')?.textContent).toBe('Xiangzi MD')
  })

  it('uses the app icon instead of repeating the app name in the Windows menu row', () => {
    const host = renderTitleBar({ documentName: 'notes.md' })
    const appMenu = host.querySelector<HTMLButtonElement>('.titlebar-menubar-button-app')

    expect(appMenu?.getAttribute('aria-label')).toBe('Xiangzi MD')
    expect(appMenu?.textContent).toBe('')
    expect(appMenu?.querySelector('.titlebar-app-icon')).not.toBeNull()
  })

  it('blocks the browser context menu on the title bar without bubbling it', () => {
    const host = renderTitleBar({ documentName: 'notes.md' })
    const titleBar = host.querySelector<HTMLElement>('.titlebar')
    let bubbled = false
    document.body.addEventListener('contextmenu', () => {
      bubbled = true
    })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    act(() => {
      titleBar?.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(bubbled).toBe(false)
  })
})
