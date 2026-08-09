// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MacWindowBar from './MacWindowBar'

const { runWindowActionMock, startWindowDraggingMock } = vi.hoisted(() => ({
  runWindowActionMock: vi.fn().mockResolvedValue(undefined),
  startWindowDraggingMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/windowActions', () => ({
  runWindowAction: runWindowActionMock,
  startWindowDragging: startWindowDraggingMock,
}))

function renderWindowBar(onToggleSidebar = vi.fn()): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<MacWindowBar onToggleSidebar={onToggleSidebar} />))
  return host
}

afterEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('MacWindowBar', () => {
  it('starts native window dragging from its empty region', () => {
    const host = renderWindowBar()
    const bar = host.querySelector<HTMLElement>('.mac-window-bar')

    act(() => {
      bar?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    expect(startWindowDraggingMock).toHaveBeenCalledOnce()
  })

  it('keeps interactive controls out of the drag gesture', () => {
    const onToggleSidebar = vi.fn()
    const host = renderWindowBar(onToggleSidebar)
    const button = host.querySelector<HTMLButtonElement>('button')

    act(() => {
      button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      button?.click()
    })

    expect(startWindowDraggingMock).not.toHaveBeenCalled()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })

  it('maximizes on a double click in the empty region', () => {
    const host = renderWindowBar()
    const bar = host.querySelector<HTMLElement>('.mac-window-bar')

    act(() => {
      bar?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
    })

    expect(runWindowActionMock).toHaveBeenCalledWith('maximize')
  })
})
