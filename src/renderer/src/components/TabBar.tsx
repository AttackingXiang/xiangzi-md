import { useEffect, useRef } from 'react'
import { Code2, Eye, List, PanelLeft, X } from 'lucide-react'
import type { Tab } from '../types'
import { t } from '../lib/i18n'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onTabContext: (id: string, x: number, y: number) => void
  sourceMode: boolean
  outlineVisible: boolean
  onToggleSource: () => void
  onToggleSidebar: () => void
  onToggleOutline: () => void
}

export default function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onTabContext,
  sourceMode,
  outlineVisible,
  onToggleSource,
  onToggleSidebar,
  onToggleOutline
}: Props): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  // 切换标签时把活动标签滚动到可见区域（标签很多时尤其需要）
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeId])

  // 拦截 wheel 事件并统一转为水平滚动。
  // 不拦截时，鼠标滚轮的 deltaY 事件会在子 .tab 元素上被消费掉（无法垂直滚动），
  // 指针在 scroll 后悬停到另一个子元素上，后续事件就丢失了，看起来"滚一下就停"。
  // 由我们接管后：trackpad 横扫 (deltaX) + 鼠标滚轮 (deltaY) 都直接修改 scrollLeft，
  // preventDefault 阻止浏览器再将事件分发到父级或子元素。
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

  return (
    <div className="tabbar">
      <button className="icon-btn drag-none" title={`${t('切换侧边栏')} (⌘\\)`} onClick={onToggleSidebar}>
        <PanelLeft size={16} />
      </button>

      <div className="tabs" ref={tabsRef}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={tab.id === activeId ? activeRef : undefined}
            className={`tab${tab.id === activeId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onTabContext(tab.id, e.clientX, e.clientY)
            }}
            onAuxClick={(e) => {
              // 鼠标中键关闭标签
              if (e.button === 1) {
                e.preventDefault()
                onClose(tab.id)
              }
            }}
            title={tab.path ?? tab.name}
          >
            <span className="tab-name">{tab.name}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              {tab.dirty ? <span className="dot" /> : <X size={13} />}
            </button>
          </div>
        ))}
      </div>

      <button
        className={`icon-btn drag-none${outlineVisible ? ' active' : ''}`}
        title={`${t('大纲')} (⌘⇧K)`}
        onClick={onToggleOutline}
      >
        <List size={16} />
      </button>
      <button
        className={`icon-btn drag-none${sourceMode ? ' active' : ''}`}
        title={`${t('源码 / 所见即所得')} (⌘/)`}
        onClick={onToggleSource}
      >
        {sourceMode ? <Eye size={16} /> : <Code2 size={16} />}
      </button>
    </div>
  )
}
