import { SettingsPage, SettingsCard, ToggleRow } from './primitives'
import type { SectionProps } from './types'

export default function ControlsSection({ settings, onChange, en }: SectionProps): JSX.Element {
  return (
    <SettingsPage
      title={en ? 'Controls' : '控件'}
      description={
        en
          ? 'Choose which workspace controls stay visible.'
          : '选择主界面中需要持续显示的操作控件。'
      }
    >
      <SettingsCard title={en ? 'Bottom bar' : '底部栏'}>
        <ToggleRow
          label={en ? 'Show bottom bar' : '显示底部一行'}
          description={
            en
              ? 'Show document status and the optional view controls at the bottom.'
              : '在底部显示文档状态以及可选的阅读、源码控件。'
          }
          checked={settings.showStatusBar}
          onChange={(showStatusBar) => onChange({ showStatusBar })}
        />
        <ToggleRow
          label={en ? 'Show file path' : '显示文件路径'}
          description={
            en ? 'Show the active document path in the bottom bar.' : '在底部栏显示当前文档路径。'
          }
          checked={settings.showStatusPath}
          disabled={!settings.showStatusBar}
          onChange={(showStatusPath) => onChange({ showStatusPath })}
        />
        <ToggleRow
          label={en ? 'Show reading mode button' : '显示阅读模式按钮'}
          description={
            en ? 'Show the reading-mode switch at bottom right.' : '在右下角显示阅读模式切换按钮。'
          }
          checked={settings.showReadingModeControl}
          disabled={!settings.showStatusBar}
          onChange={(showReadingModeControl) => onChange({ showReadingModeControl })}
        />
        <ToggleRow
          label={en ? 'Show source mode button' : '显示源码切换按钮'}
          description={
            en
              ? 'Show the source/WYSIWYG switch at bottom right.'
              : '在右下角显示源码与所见即所得切换按钮。'
          }
          checked={settings.showSourceModeControl}
          disabled={!settings.showStatusBar}
          onChange={(showSourceModeControl) => onChange({ showSourceModeControl })}
        />
      </SettingsCard>
      <SettingsCard title={en ? 'Tab bar' : '标签栏'}>
        <ToggleRow
          label={en ? 'Show reveal button' : '显示定位按钮'}
          description={
            en
              ? 'Show the button that reveals the active file in the sidebar.'
              : '显示将当前文件定位到左侧目录的按钮。'
          }
          checked={settings.showRevealButton}
          onChange={(showRevealButton) => onChange({ showRevealButton })}
        />
      </SettingsCard>
      <SettingsCard title={en ? 'Sidebar header' : '侧边栏顶部'}>
        <ToggleRow
          label={en ? 'Show undo button' : '显示撤销按钮'}
          description={
            en
              ? 'Show the undo button when the sidebar has a reversible file operation.'
              : '侧边栏存在可撤销的文件操作时，显示撤销按钮。'
          }
          checked={settings.showSidebarUndoButton}
          onChange={(showSidebarUndoButton) => onChange({ showSidebarUndoButton })}
        />
        <ToggleRow
          label={en ? 'Show favorite button' : '显示收藏按钮'}
          description={
            en
              ? 'Show the button for adding the current folder to favorites.'
              : '显示收藏当前文件夹的按钮。'
          }
          checked={settings.showSidebarFavoriteButton}
          onChange={(showSidebarFavoriteButton) => onChange({ showSidebarFavoriteButton })}
        />
        <ToggleRow
          label={en ? 'Show refresh button' : '显示刷新按钮'}
          description={
            en
              ? 'Show the button for refreshing the workspace tree.'
              : '显示刷新工作区文件树的按钮。'
          }
          checked={settings.showSidebarRefreshButton}
          onChange={(showSidebarRefreshButton) => onChange({ showSidebarRefreshButton })}
        />
        <ToggleRow
          label={en ? 'Show search button' : '显示搜索按钮'}
          description={
            en
              ? 'Show the button for searching in the current folder.'
              : '显示在当前文件夹中搜索的按钮。'
          }
          checked={settings.showSidebarSearchButton}
          onChange={(showSidebarSearchButton) => onChange({ showSidebarSearchButton })}
        />
        <ToggleRow
          label={en ? 'Show file-tree sort button' : '显示文件树排序按钮'}
          description={
            en
              ? 'Show the compact sorting menu in the sidebar. Off by default.'
              : '显示侧边栏中的紧凑排序菜单；默认关闭。'
          }
          checked={settings.showSidebarSortButton}
          onChange={(showSidebarSortButton) => onChange({ showSidebarSortButton })}
        />
        <ToggleRow
          label={en ? 'Show tag-management button' : '显示标签治理按钮'}
          description={
            en ? 'Show the button for managing workspace tags.' : '显示管理工作区标签的按钮。'
          }
          checked={settings.showSidebarTagsButton}
          onChange={(showSidebarTagsButton) => onChange({ showSidebarTagsButton })}
        />
        <ToggleRow
          label={en ? 'Show open-folder button' : '显示打开文件夹按钮'}
          description={
            en
              ? 'Hidden by default — you can still open a folder from the start page or with the shortcut.'
              : '默认隐藏——仍可从首页或用快捷键打开文件夹。'
          }
          checked={settings.showOpenFolderButton}
          onChange={(showOpenFolderButton) => onChange({ showOpenFolderButton })}
        />
        <ToggleRow
          label={en ? 'Show settings button' : '显示设置按钮'}
          description={
            en
              ? 'Hidden by default — settings stay reachable with Command/Ctrl+, or the command palette.'
              : '默认隐藏——仍可用 Command/Ctrl+, 或命令面板打开设置。'
          }
          checked={settings.showSettingsButton}
          onChange={(showSettingsButton) => onChange({ showSettingsButton })}
        />
      </SettingsCard>
    </SettingsPage>
  )
}
