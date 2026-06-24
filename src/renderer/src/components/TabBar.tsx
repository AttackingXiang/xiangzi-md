import { Code2, Eye, List, PanelLeft, X } from 'lucide-react'
import type { Tab } from '../types'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
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
  sourceMode,
  outlineVisible,
  onToggleSource,
  onToggleSidebar,
  onToggleOutline
}: Props): JSX.Element {
  return (
    <div className="tabbar">
      <button className="icon-btn drag-none" title="切换侧边栏 (⌘\\)" onClick={onToggleSidebar}>
        <PanelLeft size={16} />
      </button>

      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`}
            onClick={() => onSelect(tab.id)}
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
        title="大纲 (⌘⇧K)"
        onClick={onToggleOutline}
      >
        <List size={16} />
      </button>
      <button
        className={`icon-btn drag-none${sourceMode ? ' active' : ''}`}
        title="源码 / 所见即所得 (⌘/)"
        onClick={onToggleSource}
      >
        {sourceMode ? <Eye size={16} /> : <Code2 size={16} />}
      </button>
    </div>
  )
}
