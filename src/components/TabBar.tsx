import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, List, MapPin, PanelLeft, Pin, Plus, X } from 'lucide-react'
import type { Tab } from '../types'
import { t } from '../lib/i18n'
import { stripExtension } from '../lib/path'
import { shortcutHint } from '../lib/shortcuts'

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
}: Props): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const overflowBtnRef = useRef<HTMLButtonElement>(null)
  const overflowPanelRef = useRef<HTMLDivElement>(null)

  const [hasOverflow, setHasOverflow] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)

  // Drag state — operates on normalTabs local indices
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; side: 'left' | 'right' } | null>(
    null,
  )

  // Split into pinned (locked) and scrollable
  const pinnedTabs = tabs.filter((t) => t.locked)
  const normalTabs = tabs.filter((t) => !t.locked)

  // Scroll active tab into view (only applies to scrollable area)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeId])

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

  // ── Drag helpers (local to normalTabs) ───────────────────────────────────

  const handleDragOver = (e: React.DragEvent, localIndex: number): void => {
    e.preventDefault()
    if (dragIndex === null) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    if (dropTarget?.index !== localIndex || dropTarget.side !== side)
      setDropTarget({ index: localIndex, side })
  }

  const handleDrop = (e: React.DragEvent, localIndex: number): void => {
    e.preventDefault()
    if (dragIndex === null || dropTarget === null) return
    const localInsertAt = dropTarget.side === 'right' ? localIndex + 1 : localIndex
    // Convert local indices → global indices in tabs[]
    const fromGlobal = tabs.findIndex((tb) => tb.id === normalTabs[dragIndex]?.id)
    const insertGlobal =
      localInsertAt < normalTabs.length
        ? tabs.findIndex((tb) => tb.id === normalTabs[localInsertAt]?.id)
        : tabs.length
    if (fromGlobal !== -1) onMoveTab(fromGlobal, insertGlobal)
    setDragIndex(null)
    setDropTarget(null)
  }

  // ── Shared tab renderer ───────────────────────────────────────────────────

  const renderTab = (
    tab: Tab,
    extra?: React.HTMLAttributes<HTMLDivElement> & { 'data-drag-idx'?: number },
  ): JSX.Element => {
    const isActive = tab.id === activeId
    const { 'data-drag-idx': localIdx, ...divProps } = extra ?? {}
    const isDragging = localIdx !== undefined && dragIndex === localIdx
    const dropLeft =
      localIdx !== undefined && dropTarget?.index === localIdx && dropTarget.side === 'left'
    const dropRight =
      localIdx !== undefined && dropTarget?.index === localIdx && dropTarget.side === 'right'

    return (
      <div
        key={tab.id}
        ref={isActive ? activeRef : undefined}
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
        {...divProps}
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
    <div className="tabbar">
      <button
        className="icon-btn drag-none"
        title={`${t('切换侧边栏')} (${shortcutHint('Mod+\\')})`}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={16} />
      </button>

      {showRevealButton && onRevealFile && activeHasPath && (
        <button className="icon-btn drag-none" title={t('在文件夹中定位')} onClick={onRevealFile}>
          <MapPin size={16} />
        </button>
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
      <div className="tabs" ref={tabsRef}>
        {normalTabs.map((tab, localIdx) =>
          renderTab(tab, {
            draggable: true,
            onDragStart: () => setDragIndex(localIdx),
            onDragOver: (e: React.DragEvent) => handleDragOver(e, localIdx),
            onDrop: (e: React.DragEvent) => handleDrop(e, localIdx),
            onDragEnd: () => {
              setDragIndex(null)
              setDropTarget(null)
            },
            'data-drag-idx': localIdx,
          }),
        )}
      </div>

      {/* ── 溢出列表按钮 ──────────────────────────────────────────────── */}
      {hasOverflow && (
        <div className="tab-overflow-wrap">
          <button
            ref={overflowBtnRef}
            className={`icon-btn drag-none${showOverflow ? ' active' : ''}`}
            title={t('所有已打开标签')}
            onClick={() => setShowOverflow((v) => !v)}
          >
            <ChevronDown size={14} />
          </button>

          {showOverflow && (
            <div
              className="tab-overflow-panel"
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

      <button className="icon-btn tab-add drag-none" title={t('打开首页')} onClick={onShowWelcome}>
        <Plus size={16} />
      </button>

      <button
        className={`icon-btn drag-none${outlineVisible ? ' active' : ''}`}
        title={`${t('大纲')}（${outlineVisible ? t('已显示') : t('已隐藏')}）${shortcutHint('Mod+Shift+K')}`}
        onClick={onToggleOutline}
      >
        <List size={16} />
      </button>
    </div>
  )
})

export default TabBar
