// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../types'
import TabBar, { TAB_DRAG_MIME } from './TabBar'

const { startWindowDraggingMock } = vi.hoisted(() => ({
  startWindowDraggingMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/windowActions', () => ({
  startWindowDragging: startWindowDraggingMock,
}))

vi.mock('./LazyHoverScrollbars', () => ({ default: () => null }))

function tab(id: string): Tab {
  return {
    id,
    path: `/notes/${id}.md`,
    name: `${id}.md`,
    content: '',
    savedContent: '',
    dirty: false,
    revision: 0,
    version: null,
  }
}

function dragEvent(type: string, dataTransfer: DataTransfer, clientX: number): DragEvent {
  const event = new DragEvent(type, { bubbles: true, clientX })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

function renderTabBar({
  enableWindowDragging = true,
  onMoveTab = vi.fn(),
  onSelect = vi.fn(),
}: {
  enableWindowDragging?: boolean
  onMoveTab?: (fromIndex: number, insertAt: number) => void
  onSelect?: (id: string) => void
} = {}): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      <TabBar
        tabs={[tab('a'), tab('b')]}
        activeId="a"
        onSelect={onSelect}
        onClose={vi.fn()}
        onMoveTab={onMoveTab}
        onTabContext={vi.fn()}
        onShowWelcome={vi.fn()}
        outlineVisible={false}
        onToggleSidebar={vi.fn()}
        onToggleOutline={vi.fn()}
        showLeadingControls={false}
        enableWindowDragging={enableWindowDragging}
      />,
    ),
  )
  return host
}

afterEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('TabBar window and tab dragging', () => {
  it('starts window dragging only from enabled blank space', () => {
    const enabledHost = renderTabBar()
    const enabledBar = enabledHost.querySelector<HTMLElement>('.tabbar')

    act(() => {
      enabledBar?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(startWindowDraggingMock).toHaveBeenCalledOnce()

    document.body.replaceChildren()
    vi.clearAllMocks()
    const disabledHost = renderTabBar({ enableWindowDragging: false })
    const disabledBar = disabledHost.querySelector<HTMLElement>('.tabbar')
    act(() => {
      disabledBar?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(startWindowDraggingMock).not.toHaveBeenCalled()
  })

  it('keeps file tabs out of the window drag gesture', () => {
    const onSelect = vi.fn()
    const host = renderTabBar({ onSelect })
    const firstTab = host.querySelector<HTMLElement>('.tab')

    act(() => {
      firstTab?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    expect(startWindowDraggingMock).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('uses the internal tab id payload when reordering tabs', () => {
    const onMoveTab = vi.fn()
    const host = renderTabBar({ onMoveTab })
    const tabs = host.querySelectorAll<HTMLElement>('.tab')
    const dataTransfer = new DataTransfer()

    act(() => {
      tabs[0]?.dispatchEvent(dragEvent('dragstart', dataTransfer, 10))
    })

    expect(dataTransfer.getData(TAB_DRAG_MIME)).toBe('a')
    expect(dataTransfer.effectAllowed).toBe('move')

    Object.defineProperty(tabs[1], 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, width: 100 }),
    })
    act(() => {
      tabs[1]?.dispatchEvent(dragEvent('dragover', dataTransfer, 180))
      tabs[1]?.dispatchEvent(dragEvent('drop', dataTransfer, 180))
    })

    expect(onMoveTab).toHaveBeenCalledWith(0, 2)
  })
})
