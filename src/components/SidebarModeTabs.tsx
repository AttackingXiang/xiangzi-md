import { FolderTree, Search, Tags } from 'lucide-react'
import type { SidebarMode } from '../lib/sidebarMode'
import { t } from '../lib/i18n'

interface Props {
  mode: SidebarMode
  onChange: (mode: SidebarMode) => void
}

const TABS: { mode: SidebarMode; labelZh: string; Icon: typeof Search }[] = [
  { mode: 'files', labelZh: '文件', Icon: FolderTree },
  { mode: 'search', labelZh: '搜索', Icon: Search },
  { mode: 'tags', labelZh: '标签', Icon: Tags },
]

/**
 * 左栏顶部的模式切换器。
 *
 * 在这之前，进搜索靠头部的放大镜、进标签靠 Tags 图标、退出靠面板内部各自的
 * "返回文件" 按钮——三个单向入口，任何时候都看不出"一共几个模式、我在哪个"。
 * 这一行同时承担了状态显示和双向切换。
 */
export default function SidebarModeTabs({ mode, onChange }: Props): JSX.Element {
  return (
    <div className="sidebar-mode-tabs" role="tablist" aria-label={t('侧边栏视图')}>
      {TABS.map(({ mode: value, labelZh, Icon }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          className={`sidebar-mode-tab${mode === value ? ' active' : ''}`}
          title={t(labelZh)}
          onClick={() => onChange(value)}
        >
          <Icon size={14} />
          <span>{t(labelZh)}</span>
        </button>
      ))}
    </div>
  )
}
