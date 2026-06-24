import type { Tab } from '../types'

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  sourceMode: boolean
  onToggleSource: () => void
  onToggleSidebar: () => void
}

export default function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  sourceMode,
  onToggleSource,
  onToggleSidebar
}: Props): JSX.Element {
  return (
    <div className="tabbar">
      <button className="icon-btn tabbar-toggle" title="切换侧边栏 (Cmd/Ctrl+B)" onClick={onToggleSidebar}>
        ☰
      </button>

      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(tab.id)}
            title={tab.path ?? tab.name}
          >
            <span className="tab-name">{tab.name}</span>
            <span className="tab-dirty">{tab.dirty ? '●' : ''}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        className={`icon-btn mode-toggle${sourceMode ? ' active' : ''}`}
        title="切换源码模式 (Cmd/Ctrl+/)"
        onClick={onToggleSource}
      >
        {sourceMode ? '</>' : '👁'}
      </button>
    </div>
  )
}
