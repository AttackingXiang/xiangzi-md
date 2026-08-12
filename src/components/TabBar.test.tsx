// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../types'
import TabBar from './TabBar'

const { startWindowDraggingMock } = vi.hoisted(() => ({
  startWindowDraggingMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/windowActions', () => ({
  startWindowDragging: startWindowDraggingMock,
}))

vi.mock('./LazyHoverScrollbars', () => ({ default: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mountedRoots: Root[] = []

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

function pointerEvent(
  type: string,
  init: { clientX?: number; clientY?: number; button?: number } = {},
): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })
}

function renderTabBar({
  enableWindowDragging = true,
  showLeadingControls = false,
  onMoveTab = vi.fn(),
  onSelect = vi.fn(),
  onClose = vi.fn(),
  tabs = [tab('a'), tab('b')],
  activeId = 'a',
}: {
  enableWindowDragging?: boolean
  showLeadingControls?: boolean
  onMoveTab?: (fromIndex: number, insertAt: number) => void
  onSelect?: (id: string) => void
  onClose?: (id: string) => void
  tabs?: Tab[]
  activeId?: string | null
} = {}): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  act(() =>
    root.render(
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={onSelect}
        onClose={onClose}
        onMoveTab={onMoveTab}
        onTabContext={vi.fn()}
        onShowWelcome={vi.fn()}
        outlineVisible={false}
        onToggleSidebar={vi.fn()}
        onToggleOutline={vi.fn()}
        showLeadingControls={showLeadingControls}
        enableWindowDragging={enableWindowDragging}
      />,
    ),
  )
  return host
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('TabBar window and tab dragging', () => {
  it('keeps macOS leading controls at the compact window-bar size', () => {
    const host = renderTabBar({ showLeadingControls: true })
    const leadingButton = host.querySelector<HTMLButtonElement>('.tabbar > .icon-btn')
    const leadingIcon = leadingButton?.querySelector('svg')

    expect(leadingButton?.classList.contains('sm')).toBe(true)
    expect(leadingIcon?.getAttribute('width')).toBe('15')
    expect(leadingIcon?.getAttribute('height')).toBe('15')
  })

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
      firstTab?.dispatchEvent(pointerEvent('pointerdown'))
      window.dispatchEvent(pointerEvent('pointerup'))
    })

    expect(startWindowDraggingMock).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('reorders tabs via pointer drag, since HTML5 draggable is unreliable in WKWebView', () => {
    const onMoveTab = vi.fn()
    const host = renderTabBar({ onMoveTab })
    const tabs = host.querySelectorAll<HTMLElement>('.tab')

    Object.defineProperty(tabs[1], 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, width: 100 }),
    })
    const elementFromPointSpy = vi
      .spyOn(document, 'elementFromPoint')
      .mockReturnValue(tabs[1] ?? null)

    act(() => {
      tabs[0]?.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 180, clientY: 10 }))
      window.dispatchEvent(pointerEvent('pointerup', { clientX: 180, clientY: 10 }))
    })

    expect(onMoveTab).toHaveBeenCalledWith(0, 2)
    elementFromPointSpy.mockRestore()
  })

  it('treats a plain click (no movement) as a selection, not a reorder', () => {
    const onMoveTab = vi.fn()
    const onSelect = vi.fn()
    const host = renderTabBar({ onMoveTab, onSelect })
    const tabs = host.querySelectorAll<HTMLElement>('.tab')

    act(() => {
      tabs[0]?.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
      window.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }))
    })

    expect(onSelect).toHaveBeenCalledWith('a')
    expect(onMoveTab).not.toHaveBeenCalled()
  })

  it('keeps the close action present and named independently from unsaved state', () => {
    const dirtyTab = { ...tab('draft'), dirty: true }
    const host = renderTabBar({ tabs: [dirtyTab, tab('saved')], activeId: 'saved' })
    const renderedTabs = host.querySelectorAll<HTMLElement>('.tab')
    const dirtyClose = renderedTabs[0]?.querySelector<HTMLButtonElement>('.tab-close')
    const savedClose = renderedTabs[1]?.querySelector<HTMLButtonElement>('.tab-close')
    const dirtyIndicator = renderedTabs[0]?.querySelector<HTMLElement>('.tab-dirty-indicator')

    expect(dirtyClose?.getAttribute('aria-label')).toBe('关闭标签页: draft')
    expect(dirtyClose?.getAttribute('title')).toBe('关闭标签页: draft')
    expect(dirtyClose?.querySelector('svg')).not.toBeNull()
    expect(savedClose?.querySelector('svg')).not.toBeNull()
    expect(dirtyIndicator?.getAttribute('aria-label')).toBe('未保存')
    expect(renderedTabs[1]?.querySelector('.tab-dirty-indicator')).toBeNull()
  })

  it('closes the requested tab without selecting or starting a drag', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    const onMoveTab = vi.fn()
    const host = renderTabBar({ onClose, onSelect, onMoveTab })
    const closeButton = host.querySelector<HTMLButtonElement>('.tab-close')

    act(() => {
      closeButton?.dispatchEvent(pointerEvent('pointerdown'))
      closeButton?.click()
    })

    expect(onClose).toHaveBeenCalledWith('a')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onMoveTab).not.toHaveBeenCalled()
  })
})
