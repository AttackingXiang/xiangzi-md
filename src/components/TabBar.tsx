import { memo, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronDown, List, MapPin, PanelLeft, Pin, Plus, X } from 'lucide-react'
import type { Tab } from '../types'
import { t } from '../lib/i18n'
import { stripExtension } from '../lib/path'
import { shortcutHint } from '../lib/shortcuts'
import { handleWindowDragPointerDown } from '../lib/windowDragRegion'
import HoverScrollbars from './LazyHoverScrollbars'

export const TAB_DRAG_MIME = 'application/x-xiangzi-tab'

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

  const clearTabDrag = (): void => {
    setDraggedTabId(null)
    setDropTarget(null)
  }

  const isInternalTabDrag = (event: React.DragEvent): boolean =>
    draggedTabId !== null || Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME)

  const dropSide = (event: React.DragEvent): 'left' | 'right' => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
  }

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, tabId: string): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TAB_DRAG_MIME, tabId)
    setDraggedTabId(tabId)
  }

  const handleDragOver = (event: React.DragEvent, tabId: string): void => {
    if (!isInternalTabDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const side = dropSide(event)
    if (dropTarget?.tabId !== tabId || dropTarget.side !== side) setDropTarget({ tabId, side })
  }

  const handleDrop = (event: React.DragEvent, targetTabId: string): void => {
    if (!isInternalTabDrag(event)) return
    event.preventDefault()
    const sourceTabId = event.dataTransfer.getData(TAB_DRAG_MIME) || draggedTabId
    const fromGlobal = tabs.findIndex((tab) => tab.id === sourceTabId)
    const targetGlobal = tabs.findIndex((tab) => tab.id === targetTabId)
    if (fromGlobal !== -1 && targetGlobal !== -1) {
      const insertAt = targetGlobal + (dropSide(event) === 'right' ? 1 : 0)
      onMoveTab(fromGlobal, insertAt)
    }
    clearTabDrag()
  }

  // ── Shared tab renderer ───────────────────────────────────────────────────

  const renderTab = (tab: Tab, extra?: React.HTMLAttributes<HTMLDivElement>): JSX.Element => {
    const isActive = tab.id === activeId
    const isDragging = draggedTabId === tab.id
    const dropLeft = dropTarget?.tabId === tab.id && dropTarget.side === 'left'
    const dropRight = dropTarget?.tabId === tab.id && dropTarget.side === 'right'

    return (
      <div
        key={tab.id}
        ref={isActive ? activeRef : undefined}
        data-window-drag-interactive
        className={[
          'tab',
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
          if (e.button === 0) onSelect(tab.id)
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
        {...extra}
      >
        <span className="tab-name">{stripExtension(tab.name)}</span>
        <button
          className="tab-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose(tab.id)
          }}
        >
          {tab.dirty ? <span className="dot" /> : <X size={13} />}
        </button>
      </div>
    )
  }

  return (
    <div
      className="tabbar"
      onPointerDown={enableWindowDragging ? handleWindowDragPointerDown : undefined}
    >
      {showLeadingControls && (
        <>
          <button
            className="icon-btn"
            title={`${t('切换侧边栏')} (${shortcutHint('Mod+\\')})`}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} />
          </button>

          {showRevealButton && onRevealFile && activeHasPath && (
            <button className="icon-btn" title={t('在文件夹中定位')} onClick={onRevealFile}>
              <MapPin size={16} />
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
          {normalTabs.map((tab) =>
            renderTab(tab, {
              draggable: true,
              onDragStart: (event) => handleDragStart(event, tab.id),
              onDragOver: (event) => handleDragOver(event, tab.id),
              onDrop: (event) => handleDrop(event, tab.id),
              onDragEnd: clearTabDrag,
            }),
          )}
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
