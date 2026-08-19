import { memo, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronDown, List, MapPin, PanelLeft, Pin, Plus, X } from 'lucide-react'
import type { Tab } from '../types'
import { t } from '../lib/i18n'
import { stripExtension } from '../lib/path'
import { shortcutHint } from '../lib/shortcuts'
import { runWindowAction } from '../lib/windowActions'
import { handleWindowDragPointerDown, isWindowDragInteractiveTarget } from '../lib/windowDragRegion'
import HoverScrollbars from './LazyHoverScrollbars'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onMoveTab: (fromIndex: number, insertAt: number) => void
  onTabContext: (id: string, x: number, y: number) => void
  onShowWelcome: () => void
  outlineVisible: boolean
  onToggleSidebar: () => void
  onToggleOutline: () => void
  onRevealFile?: () => void
  activeHasPath?: boolean
  showRevealButton?: boolean
  showLeadingControls?: boolean
  enableWindowDragging?: boolean
}

const TabBar = memo(function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onMoveTab,
  onTabContext,
  onShowWelcome,
  outlineVisible,
  onToggleSidebar,
  onToggleOutline,
  onRevealFile,
  activeHasPath,
  showRevealButton = true,
  showLeadingControls = true,
  enableWindowDragging = false,
}: Props): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const overflowBtnRef = useRef<HTMLButtonElement>(null)
  const overflowPanelRef = useRef<HTMLDivElement>(null)

  const [hasOverflow, setHasOverflow] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const leadingControlClassName = enableWindowDragging ? 'icon-btn sm' : 'icon-btn'
  const leadingControlIconSize = enableWindowDragging ? 15 : 16

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ tabId: string; side: 'left' | 'right' } | null>(
    null,
  )

  // Split into pinned (locked) and scrollable
  const pinnedTabs = tabs.filter((t) => t.locked)
  const normalTabs = tabs.filter((t) => !t.locked)
  const firstNormalTabId = normalTabs[0]?.id
  const normalTabOrderKey = normalTabs.map((tab) => tab.id).join('\u0000')

  // Scroll active tab into view (only applies to scrollable area)
  useEffect(() => {
    if (!normalTabOrderKey) return
    const activeTab = activeRef.current
    const scrollArea = tabsRef.current
    if (!activeTab || !scrollArea) return

    if (firstNormalTabId === activeId) {
      scrollArea.scrollLeft = 0
      return
    }

    activeTab.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeId, firstNormalTabId, normalTabOrderKey])

  // Horizontal scroll via wheel on the scrollable area
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      el.scrollLeft += e.deltaX + e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Detect overflow in the scrollable area
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setHasOverflow(el.scrollWidth > el.clientWidth))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = tabsRef.current
      if (el) setHasOverflow(el.scrollWidth > el.clientWidth)
    })
    return () => cancelAnimationFrame(id)
  }, [tabs])

  // Close overflow panel on outside click
  useEffect(() => {
    if (!showOverflow) return
    const close = (e: MouseEvent): void => {
      if (
        !overflowPanelRef.current?.contains(e.target as globalThis.Node) &&
        !overflowBtnRef.current?.contains(e.target as globalThis.Node)
      )
        setShowOverflow(false)
    }
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [showOverflow])

  // ── Drag helpers ──────────────────────────────────────────────────────────
  // HTML5 drag-and-drop (`draggable`, dragstart/dragover/drop) is unreliable in
  // WKWebView — dragstart routinely never fires — so tab reordering is driven
  // by pointer events instead, mirroring the outline / tag-tree drag.

  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const clearTabDrag = (): void => {
    setDraggedTabId(null)
    setDropTarget(null)
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, fromTabId: string): void => {
    if (event.button !== 0) return
    dragCleanupRef.current?.()
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      window.removeEventListener('blur', handlePointerCancel, true)
      document.body.classList.remove('tab-pointer-dragging')
      clearTabDrag()
      dragCleanupRef.current = null
    }

    const resolveTarget = (
      clientX: number,
      clientY: number,
    ): { tabId: string; side: 'left' | 'right' } | null => {
      const candidate = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>('[data-tab-drag-id]')
      if (!candidate) return null
      const tabId = candidate.dataset.tabDragId
      if (!tabId) return null
      const rect = candidate.getBoundingClientRect()
      const side = clientX < rect.left + rect.width / 2 ? 'left' : 'right'
      return { tabId, side }
    }

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
        return
      }
      if (!dragging) {
        dragging = true
        setDraggedTabId(fromTabId)
        document.body.classList.add('tab-pointer-dragging')
        window.getSelection()?.removeAllRanges()
      }
      moveEvent.preventDefault()
      setDropTarget(resolveTarget(moveEvent.clientX, moveEvent.clientY))
    }

    const handlePointerUp = (upEvent: PointerEvent): void => {
      const target = dragging ? resolveTarget(upEvent.clientX, upEvent.clientY) : null
      if (dragging) upEvent.preventDefault()
      cleanup()
      if (!target || target.tabId === fromTabId) return
      const fromGlobal = tabs.findIndex((tab) => tab.id === fromTabId)
      const targetGlobal = tabs.findIndex((tab) => tab.id === target.tabId)
      if (fromGlobal === -1 || targetGlobal === -1) return
      const insertAt = targetGlobal + (target.side === 'right' ? 1 : 0)
      onMoveTab(fromGlobal, insertAt)
    }

    const handlePointerCancel = (): void => cleanup()

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel, true)
    window.addEventListener('blur', handlePointerCancel, true)
    dragCleanupRef.current = cleanup
  }

  // ── Shared tab renderer ───────────────────────────────────────────────────

  const renderTab = (tab: Tab, reorderable = false): JSX.Element => {
    const isActive = tab.id === activeId
    const isDragging = draggedTabId === tab.id
    const dropLeft = dropTarget?.tabId === tab.id && dropTarget.side === 'left'
    const dropRight = dropTarget?.tabId === tab.id && dropTarget.side === 'right'
    const displayName = stripExtension(tab.name)
    const closeLabel = `${t('关闭标签页')}: ${displayName}`

    return (
      <div
        key={tab.id}
        ref={isActive ? activeRef : undefined}
        data-window-drag-interactive
        data-tab-drag-id={reorderable ? tab.id : undefined}
        className={[
          'tab',
          reorderable ? 'tab-reorderable' : '',
          isActive ? 'active' : '',
          tab.dirty ? 'dirty' : '',
          isDragging ? 'tab-dragging' : '',
          dropLeft ? 'drop-left' : '',
          dropRight ? 'drop-right' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title={tab.path ?? tab.name}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          onSelect(tab.id)
          if (reorderable) startDrag(e, tab.id)
        }}
        onClick={(e) => {
          if (e.detail === 0) onSelect(tab.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onTabContext(tab.id, e.clientX, e.clientY)
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            onClose(tab.id)
          }
        }}
      >
        <span className="tab-name">{displayName}</span>
        {tab.dirty && (
          <span className="dot tab-dirty-indicator" role="img" aria-label={t('未保存')} />
        )}
        <button
          type="button"
          className="tab-close"
          aria-label={closeLabel}
          title={closeLabel}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose(tab.id)
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={`tabbar${showOverflow ? ' overflow-open' : ''}`}
      onPointerDown={enableWindowDragging ? handleWindowDragPointerDown : undefined}
      onDoubleClick={
        enableWindowDragging
          ? (event) => {
              if (isWindowDragInteractiveTarget(event.target)) return
              event.preventDefault()
              void runWindowAction('maximize').catch((error: unknown) =>
                console.error('Window maximize failed', error),
              )
            }
          : undefined
      }
    >
      {showLeadingControls && (
        <>
          <button
            className={leadingControlClassName}
            title={`${t('切换侧边栏')} (${shortcutHint('Mod+\\')})`}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={leadingControlIconSize} />
          </button>

          {showRevealButton && onRevealFile && activeHasPath && (
            <button
              className={leadingControlClassName}
              title={t('在文件夹中定位')}
              onClick={onRevealFile}
            >
              <MapPin size={leadingControlIconSize} />
            </button>
          )}
        </>
      )}

      {/* ── 固定区（pinned / locked tabs） ────────────────────────────── */}
      {pinnedTabs.length > 0 && (
        <>
          <div className="tabs-pinned">
            {pinnedTabs.map((tab) => {
              const isActive = tab.id === activeId
              return (
                <div
                  key={tab.id}
                  data-window-drag-interactive
                  className={['tab tab-pinned', isActive ? 'active' : '', tab.dirty ? 'dirty' : '']
                    .filter(Boolean)
                    .join(' ')}
                  title={tab.path ?? tab.name}
                  onPointerDown={(e) => {
                    if (e.button === 0) onSelect(tab.id)
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) onSelect(tab.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onTabContext(tab.id, e.clientX, e.clientY)
                  }}
                >
                  <Pin size={10} className="tab-pin-icon" />
                  <span className="tab-name">{stripExtension(tab.name)}</span>
                  {tab.dirty && <span className="dot dot-pinned" />}
                </div>
              )
            })}
          </div>
          <div className="tabs-divider" />
        </>
      )}

      {/* ── 滚动区（normal tabs） ──────────────────────────────────────── */}
      <div className="scrollbar-host tabs-scrollbar-host">
        <div className="tabs" ref={tabsRef}>
          {normalTabs.map((tab) => renderTab(tab, true))}
        </div>
        <Suspense fallback={null}>
          <HoverScrollbars targetRef={tabsRef} axes="horizontal" />
        </Suspense>
      </div>

      <div className="tabbar-actions">
        {/* ── 溢出列表按钮 ────────────────────────────────────────────── */}
        {hasOverflow && (
          <div className="tab-overflow-wrap">
            <button
              ref={overflowBtnRef}
              className={`icon-btn${showOverflow ? ' active' : ''}`}
              title={t('所有已打开标签')}
              onClick={() => setShowOverflow((v) => !v)}
            >
              <ChevronDown size={14} />
            </button>

            {showOverflow && (
              <div
                className="tab-overflow-panel"
                data-window-drag-interactive
                ref={overflowPanelRef}
                style={
                  showOverflow
                    ? (() => {
                        const rect = overflowBtnRef.current?.getBoundingClientRect()
                        return rect
                          ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                          : {}
                      })()
                    : undefined
                }
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`tab-overflow-item${tab.id === activeId ? ' active' : ''}`}
                  >
                    <button
                      className="tab-overflow-select"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(tab.id)
                        setShowOverflow(false)
                      }}
                    >
                      {tab.dirty && <span className="dot" />}
                      {tab.locked && <Pin size={11} className="tab-overflow-lock" />}
                      <span className="tab-overflow-name">{stripExtension(tab.name)}</span>
                    </button>
                    <button
                      className="tab-overflow-close"
                      disabled={tab.locked}
                      title={tab.locked ? t('已固定（右键解除固定）') : t('关闭')}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onClose(tab.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button className="icon-btn tab-add" title={t('打开首页')} onClick={onShowWelcome}>
          <Plus size={16} />
        </button>

        <button
          className={`icon-btn${outlineVisible ? ' active' : ''}`}
          title={`${t('大纲')}（${outlineVisible ? t('已显示') : t('已隐藏')}）${shortcutHint('Mod+Shift+K')}`}
          onClick={onToggleOutline}
        >
          <List size={16} />
        </button>
      </div>
    </div>
  )
})

export default TabBar
