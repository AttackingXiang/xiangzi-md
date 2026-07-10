import {
  BookOpen,
  Bug,
  ChevronRight,
  ExternalLink,
  FileImage,
  FileType2,
  Files,
  Info,
  Keyboard,
  HeartHandshake,
  PanelBottom,
  Palette,
  PenLine,
  RefreshCw,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { desktop } from '../platform'
import type { AppSettings } from '../types'
import type { UpdaterController } from '../hooks/useUpdater'
import Shortcuts from './Shortcuts'
import { getLang, t } from '../lib/i18n'
import licenseText from '../../LICENSE?raw'
import alipaySupportQr from '../assets/support/alipay-support.jpg'
import paypalSupportQr from '../assets/support/paypal-support.png'
import wechatSupportQr from '../assets/support/wechat-support.jpg'

const PROJECT_URL = 'https://github.com/AttackingXiang/xiangzi-md'
const PAYPAL_SUPPORT_URL = 'https://www.paypal.com/ncp/payment/Q3YKYE86YKBPJ'
const ABOUT_LINKS = {
  guide: `${PROJECT_URL}/blob/main/docs/USER_GUIDE.md`,
  releases: `${PROJECT_URL}/releases`,
  feedback: `${PROJECT_URL}/issues/new/choose`,
  privacy: `${PROJECT_URL}/blob/main/PRIVACY.md`,
  project: PROJECT_URL,
} as const

// pandoc 状态结果类型
interface PandocStatus {
  path: string
  version: string
}

export type SettingsSection =
  | 'appearance'
  | 'editor'
  | 'controls'
  | 'files'
  | 'attachments'
  | 'word'
  | 'shortcuts'
  | 'updates'
  | 'about'

interface Props {
  settings: AppSettings
  updater: UpdaterController
  customCssError?: boolean
  backgroundImageError?: boolean
  initialSection?: SettingsSection
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
}

export default function Settings({
  settings,
  updater,
  customCssError = false,
  backgroundImageError = false,
  initialSection = 'appearance',
  onChange,
  onClose,
}: Props): JSX.Element {
  const en = getLang() === 'en'
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [appVersion, setAppVersion] = useState('—')
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const folder = settings.attachmentFolder || 'assets'
  const usesFolder = ['subfolder', 'docSubfolder', 'vaultSubfolder'].includes(
    settings.attachmentMode,
  )

  useEffect(() => {
    void desktop
      .getAppInfo()
      .then((info) => setAppVersion(info.version))
      .catch(() => undefined)
  }, [])

  const sample: Record<AppSettings['attachmentMode'], string> = {
    same: 'image.png',
    subfolder: `${folder}/image.png`,
    docSubfolder: `${folder}/${en ? 'doc-name' : '文档名'}/image.png`,
    vault: `…/image.png`,
    vaultSubfolder: `…/${folder}/image.png`,
  }

  const nav: Array<{
    id: SettingsSection
    label: string
    icon: typeof Palette
  }> = [
    { id: 'appearance', label: en ? 'Appearance' : '外观', icon: Palette },
    { id: 'editor', label: en ? 'Editor' : '编辑器', icon: PenLine },
    { id: 'controls', label: en ? 'Controls' : '控件', icon: PanelBottom },
    { id: 'files', label: en ? 'Files' : '文件', icon: Files },
    { id: 'attachments', label: en ? 'Images' : '图片与附件', icon: FileImage },
    { id: 'word', label: en ? 'Word / Pandoc' : 'Word / Pandoc', icon: FileType2 },
    { id: 'shortcuts', label: en ? 'Shortcuts' : '快捷键', icon: Keyboard },
    { id: 'updates', label: en ? 'Updates' : '软件更新', icon: RefreshCw },
    { id: 'about', label: en ? 'About' : '关于', icon: Info },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header settings-header">
          <span id="settings-title">{t('设置')}</span>
          <button
            className="icon-btn sm"
            aria-label={en ? 'Close settings' : '关闭设置'}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label={en ? 'Settings sections' : '设置分类'}>
            {nav.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={section === item.id ? 'active' : ''}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="settings-content">
            {section === 'appearance' && (
              <SettingsPage
                title={en ? 'Appearance' : '外观'}
                description={
                  en ? 'Keep the workspace calm and readable.' : '保持工作区清爽、稳定且易读。'
                }
              >
                <SettingsCard>
                  <SettingRow label={t('界面语言')}>
                    <select
                      value={settings.language}
                      onChange={(event) =>
                        onChange({ language: event.target.value as AppSettings['language'] })
                      }
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                    </select>
                  </SettingRow>
                  <SettingRow label={t('主题')}>
                    <select
                      value={settings.theme}
                      onChange={(event) =>
                        onChange({ theme: event.target.value as AppSettings['theme'] })
                      }
                    >
                      <option value="system">{t('跟随系统')}</option>
                      <option value="light">{t('浅色')}</option>
                      <option value="dark">{t('深色')}</option>
                      <option value="warm">{t('暖色')}</option>
                      <option value="mint">{t('浅绿')}</option>
                      <option value="blue">{t('蓝调')}</option>
                      <option value="summer">{t('夏日')}</option>
                    </select>
                  </SettingRow>
                  <SettingRow label={t('编辑区宽度')}>
                    <select
                      value={settings.editorWidth}
                      onChange={(event) =>
                        onChange({ editorWidth: event.target.value as AppSettings['editorWidth'] })
                      }
                    >
                      <option value="normal">{t('适中')}</option>
                      <option value="wide">{t('较宽')}</option>
                      <option value="full">{t('全宽')}</option>
                    </select>
                  </SettingRow>
                  <SettingRow label={t('主题深浅')}>
                    <span className="settings-range-control">
                      <input
                        type="range"
                        aria-label={t('主题深浅')}
                        min={-50}
                        max={50}
                        step={5}
                        value={settings.themeShade}
                        onChange={(event) => onChange({ themeShade: Number(event.target.value) })}
                      />
                      <small>
                        {settings.themeShade === 0
                          ? t('原色')
                          : settings.themeShade > 0
                            ? `${t('变亮')} ${settings.themeShade}%`
                            : `${t('加深')} ${Math.abs(settings.themeShade)}%`}
                      </small>
                    </span>
                  </SettingRow>
                  <p className="settings-range-hint">
                    {en
                      ? 'Move left to darken the theme surface and right to brighten it. This does not change the background-image intensity.'
                      : '向左会加深主题底色，向右会变亮；它不会改变背景图片强度。'}
                  </p>
                  <SettingRow label={t('代码块不透明度')}>
                    <span className="settings-range-control">
                      <input
                        type="range"
                        aria-label={t('代码块不透明度')}
                        min={0}
                        max={100}
                        step={5}
                        value={settings.codeBlockOpacity}
                        onChange={(event) =>
                          onChange({ codeBlockOpacity: Number(event.target.value) })
                        }
                      />
                      <small>{settings.codeBlockOpacity}%</small>
                    </span>
                  </SettingRow>
                </SettingsCard>
                <SettingsCard title={t('背景图片')}>
                  <div className="settings-file-picker">
                    <div>
                      <p>
                        {settings.backgroundImagePath ||
                          (en ? 'No background image' : '未设置背景图片')}
                      </p>
                    </div>
                    <span className="settings-inline">
                      {settings.backgroundImagePath && (
                        <button
                          className="secondary-btn"
                          onClick={() => onChange({ backgroundImagePath: '' })}
                        >
                          {t('清除')}
                        </button>
                      )}
                      <button
                        className="secondary-btn"
                        onClick={async () => {
                          const result = await desktop.pickImage()
                          if (result) onChange({ backgroundImagePath: result.path })
                        }}
                      >
                        {settings.backgroundImagePath ? t('更换…') : t('选择…')}
                      </button>
                    </span>
                  </div>
                  {settings.backgroundImagePath && (
                    <SettingRow label={t('背景强度')}>
                      <span className="settings-range-control">
                        <input
                          type="range"
                          aria-label={t('背景强度')}
                          min={0}
                          max={100}
                          step={5}
                          value={settings.backgroundOpacity}
                          onChange={(event) =>
                            onChange({ backgroundOpacity: Number(event.target.value) })
                          }
                        />
                        <small>{settings.backgroundOpacity}%</small>
                      </span>
                    </SettingRow>
                  )}
                  {backgroundImageError && (
                    <p className="settings-error" role="alert">
                      {en
                        ? 'The selected image could not be read. The previous background was removed.'
                        : '无法读取所选图片，旧的背景已移除。'}
                    </p>
                  )}
                </SettingsCard>
                <SettingsCard title={t('自定义主题 CSS')}>
                  <div className="settings-file-picker">
                    <div>
                      <p>
                        {settings.customCssPath || (en ? 'Use the built-in theme' : '使用内置主题')}
                      </p>
                    </div>
                    <span className="settings-inline">
                      {settings.customCssPath && (
                        <button
                          className="secondary-btn"
                          onClick={() => onChange({ customCssPath: '' })}
                        >
                          {t('清除')}
                        </button>
                      )}
                      <button
                        className="secondary-btn"
                        onClick={async () => {
                          const result = await desktop.pickCss()
                          if (result) onChange({ customCssPath: result.path })
                        }}
                      >
                        {settings.customCssPath ? t('更换…') : t('选择…')}
                      </button>
                    </span>
                  </div>
                  {customCssError && (
                    <p className="settings-error" role="alert">
                      {en
                        ? 'The selected CSS file could not be read. The previous custom theme was removed.'
                        : '无法读取所选 CSS，旧的自定义主题已移除。'}
                    </p>
                  )}
                </SettingsCard>
              </SettingsPage>
            )}

            {section === 'editor' && (
              <SettingsPage
                title={en ? 'Editor' : '编辑器'}
                description={
                  en
                    ? 'Writing behavior and document presentation.'
                    : '调整写作行为与文档呈现方式。'
                }
              >
                <SettingsCard>
                  <ToggleRow
                    label={t('标题自动编号')}
                    description={
                      en ? 'Show hierarchical numbers before headings.' : '在标题前显示层级编号。'
                    }
                    checked={settings.headingNumber}
                    onChange={(checked) => onChange({ headingNumber: checked })}
                  />
                  <ToggleRow
                    label={t('自动保存')}
                    description={t('开启后，已保存过的文档在停止输入约 1 秒后自动写回磁盘。')}
                    checked={settings.autoSave}
                    onChange={(checked) => onChange({ autoSave: checked })}
                  />
                  <ToggleRow
                    label={en ? 'Show toolbar' : '显示顶部工具栏'}
                    description={
                      en
                        ? 'Show a formatting toolbar above the editor in editing mode.'
                        : '在编辑模式下，编辑器顶部显示格式化工具栏。'
                    }
                    checked={settings.showToolbar ?? false}
                    onChange={(checked) => onChange({ showToolbar: checked })}
                  />
                </SettingsCard>
                <SettingsCard title={en ? 'Tables' : '表格'}>
                  <div className="table-layout-setting">
                    <label className="table-layout-setting-row">
                      <span className="setting-label-with-info">
                        {en ? 'Table column layout' : '表格列宽布局'}
                        <span
                          className="setting-info-icon"
                          title={
                            en
                              ? 'This is the default layout for tables without an individual override.'
                              : '这是未单独指定布局的表格所使用的默认渲染方式。'
                          }
                        >
                          <Info size={14} />
                        </span>
                      </span>
                      <select
                        value={settings.tableAutoWidth ?? 'distribute'}
                        onChange={(event) =>
                          onChange({
                            tableAutoWidth: event.target.value as AppSettings['tableAutoWidth'],
                          })
                        }
                      >
                        <option value="distribute">
                          {en ? 'Smart fill (recommended)' : '智能占满（推荐）'}
                        </option>
                        <option value="fit">{en ? 'Fit to content' : '按内容适配'}</option>
                        <option value="equal">{en ? 'Equal width' : '等宽分配'}</option>
                      </select>
                    </label>
                    <p className="table-layout-description">
                      {(settings.tableAutoWidth ?? 'distribute') === 'fit'
                        ? en
                          ? 'Fits each column to its content; wide tables may scroll horizontally.'
                          : '按单元格内容的自然宽度显示，较宽的表格可能出现横向滚动。'
                        : (settings.tableAutoWidth ?? 'distribute') === 'equal'
                          ? en
                            ? 'Gives every column the same width and fills the editor.'
                            : '所有列使用相同宽度，并铺满编辑区域。'
                          : en
                            ? 'Distributes width by content needs and fills the editor.'
                            : '根据各列内容需求智能分配宽度，并铺满编辑区域。'}
                    </p>
                  </div>
                  <ToggleRow
                    label={en ? 'Automatically resize while editing' : '编辑时自动调整表格'}
                    description={
                      en
                        ? 'After input pauses in a table cell, reapply that table’s current layout. Individual and manually resized tables keep their overrides.'
                        : '在表格单元格内停止输入后，按照该表格当前的渲染方式重新调整；单表规则和手动列宽优先保留。'
                    }
                    checked={settings.tableAutoResize ?? true}
                    onChange={(tableAutoResize) => onChange({ tableAutoResize })}
                  />
                </SettingsCard>
                <SettingsCard title={en ? 'Editor overlays' : '编辑器浮层'}>
                  <ToggleRow
                    label={en ? 'Selection toolbar' : '选中文本快捷工具栏'}
                    description={
                      en
                        ? 'Show formatting actions when regular document text is selected.'
                        : '选中普通正文时显示格式快捷操作；代码块内始终不显示。'
                    }
                    checked={settings.showSelectionToolbar}
                    onChange={(showSelectionToolbar) => onChange({ showSelectionToolbar })}
                  />
                </SettingsCard>
                <SettingsCard title={en ? 'Copy control' : '复制控制'}>
                  <SettingRow label={en ? 'Copy images as' : '图片复制为'}>
                    <select
                      value={settings.imageCopyMode ?? 'image'}
                      onChange={(event) =>
                        onChange({
                          imageCopyMode: event.target.value as AppSettings['imageCopyMode'],
                        })
                      }
                    >
                      <option value="image">{en ? 'Image' : '图片'}</option>
                      <option value="address">{en ? 'Address' : '地址'}</option>
                    </select>
                  </SettingRow>
                  <SettingRow label={en ? 'Copy Mermaid as' : 'Mermaid 复制为'}>
                    <select
                      value={settings.mermaidCopyMode ?? 'image'}
                      onChange={(event) =>
                        onChange({
                          mermaidCopyMode: event.target.value as AppSettings['mermaidCopyMode'],
                        })
                      }
                    >
                      <option value="image">{en ? 'Image' : '图片'}</option>
                      <option value="source">{en ? 'Source text' : '源文本'}</option>
                    </select>
                  </SettingRow>
                  <p className="settings-hint">
                    {en
                      ? 'Applies when the selection contains an image or Mermaid diagram. Defaults to copying the image.'
                      : '当选中内容包含图片或 Mermaid 图表时生效，默认复制图片。'}
                  </p>
                </SettingsCard>
                <SettingsCard title={en ? 'Tags' : '标签'}>
                  <SettingRow label={en ? 'Default expand level' : '默认展开层级'}>
                    <select
                      value={String(settings.tagDefaultExpandDepth ?? -1)}
                      onChange={(event) =>
                        onChange({ tagDefaultExpandDepth: Number(event.target.value) })
                      }
                    >
                      <option value="-1">{en ? 'Expand all' : '全部展开'}</option>
                      <option value="0">{en ? 'Top level only' : '仅顶层'}</option>
                      <option value="1">{en ? 'Two levels' : '展开两层'}</option>
                      <option value="2">{en ? 'Three levels' : '展开三层'}</option>
                    </select>
                  </SettingRow>
                  <SettingRow label={en ? 'Results order' : '结果列排序'}>
                    <select
                      value={settings.tagResultSort ?? 'updated'}
                      onChange={(event) =>
                        onChange({
                          tagResultSort: event.target.value as AppSettings['tagResultSort'],
                        })
                      }
                    >
                      <option value="updated">{en ? 'Last modified' : '最近修改'}</option>
                      <option value="name">{en ? 'Name' : '名称'}</option>
                    </select>
                  </SettingRow>
                  <ToggleRow
                    label={en ? 'Groups first' : '分组优先置顶'}
                    description={
                      en
                        ? 'Show tags that contain sub-tags before plain tags at each level.'
                        : '每一层里，把含子标签的分组排在普通标签前面。'
                    }
                    checked={settings.tagGroupsFirst ?? false}
                    onChange={(checked) => onChange({ tagGroupsFirst: checked })}
                  />
                  <ToggleRow
                    label={
                      en
                        ? 'Show all tags when clicking document tags'
                        : '点击文档标签时展示全部标签'
                    }
                    description={
                      en
                        ? 'When clicking a tag inside a document, show the all-tags tree on the left. Off by default — the file tree is hidden and only the results column opens.'
                        : '点文档内部的标签时，在左侧展示「全部标签」树。默认关闭——文件树会隐藏，只打开中间结果列。'
                    }
                    checked={settings.tagClickOpensOverview ?? false}
                    onChange={(checked) => onChange({ tagClickOpensOverview: checked })}
                  />
                  <p className="settings-hint">
                    {en
                      ? 'The expand/collapse state of the tag tree is remembered. Changing the default level resets it.'
                      : '标签树的展开/折叠状态会被记住；改动默认层级会重置为该层级。'}
                  </p>
                </SettingsCard>
              </SettingsPage>
            )}

            {section === 'controls' && (
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
                      en
                        ? 'Show the active document path in the bottom bar.'
                        : '在底部栏显示当前文档路径。'
                    }
                    checked={settings.showStatusPath}
                    disabled={!settings.showStatusBar}
                    onChange={(showStatusPath) => onChange({ showStatusPath })}
                  />
                  <ToggleRow
                    label={en ? 'Show reading mode button' : '显示阅读模式按钮'}
                    description={
                      en
                        ? 'Show the reading-mode switch at bottom right.'
                        : '在右下角显示阅读模式切换按钮。'
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
                        ? 'Hidden by default — settings stay reachable with ⌘, or the command palette.'
                        : '默认隐藏——仍可用 ⌘, 或命令面板打开设置。'
                    }
                    checked={settings.showSettingsButton}
                    onChange={(showSettingsButton) => onChange({ showSettingsButton })}
                  />
                </SettingsCard>
              </SettingsPage>
            )}

            {section === 'files' && (
              <SettingsPage
                title={en ? 'Files' : '文件'}
                description={
                  en
                    ? 'Control what the workspace tree displays.'
                    : '控制工作区文件树显示哪些内容。'
                }
              >
                <SettingsCard>
                  <SettingRow
                    label={en ? 'File tree sort' : '文件树排序'}
                    description={
                      en
                        ? 'How items are ordered within each folder. Pinned folders always come first.'
                        : '决定每个文件夹内文件的排列顺序；置顶的文件夹始终排在最前。'
                    }
                  >
                    <select
                      value={settings.fileTreeSort}
                      onChange={(event) =>
                        onChange({
                          fileTreeSort: event.target.value as AppSettings['fileTreeSort'],
                        })
                      }
                    >
                      <option value="default">{en ? 'Name (A→Z)' : '名称（A→Z）'}</option>
                      <option value="nameDesc">{en ? 'Name (Z→A)' : '名称（Z→A）'}</option>
                      <option value="modified">{en ? 'Recently modified' : '最近修改'}</option>
                      <option value="opened">{en ? 'Recently opened' : '最近打开'}</option>
                      <option value="smart">{en ? 'Smart (recommended)' : '智能推荐'}</option>
                    </select>
                  </SettingRow>
                  <ToggleRow
                    label={en ? 'Show all files' : '显示全部文件'}
                    description={
                      en
                        ? 'Unsupported files are visible but cannot be opened in the editor.'
                        : '不支持的文件会显示在文件树中，但不能在编辑器中打开。'
                    }
                    checked={settings.showAllFiles}
                    onChange={(checked) => onChange({ showAllFiles: checked })}
                  />
                  <ToggleRow
                    label={en ? 'Load remote images' : '加载远程图片'}
                    description={
                      en
                        ? 'Disabled by default to avoid leaking your IP address to image hosts.'
                        : '默认关闭，避免向图片服务器泄露 IP 地址等访问信息。'
                    }
                    checked={settings.allowRemoteImages}
                    onChange={(checked) => onChange({ allowRemoteImages: checked })}
                  />
                </SettingsCard>
                {settings.showAllFiles && (
                  <>
                    <SettingsCard title={en ? 'Hidden by name' : '按名称隐藏'}>
                      <p className="settings-hint">
                        {en
                          ? 'Any file or folder whose name exactly matches a pattern is hidden everywhere in the workspace tree.'
                          : '文件或文件夹名称完全匹配时，在工作区任何位置都会被隐藏。'}
                      </p>
                      <HiddenNamePatterns
                        patterns={settings.hiddenNamePatterns}
                        onChange={(hiddenNamePatterns) => onChange({ hiddenNamePatterns })}
                        en={en}
                      />
                    </SettingsCard>
                    <SettingsCard title={en ? 'Hidden folders' : '手动隐藏的文件夹'}>
                      <p className="settings-hint">
                        {en
                          ? 'Selected folders and all descendants are omitted from the workspace tree.'
                          : '选中的文件夹及其全部子项不会出现在工作区文件树中。'}
                      </p>
                      <div className="settings-path-list">
                        {settings.hiddenWorkspacePaths.length === 0 && (
                          <p className="settings-empty-text">
                            {en ? 'No folders are hidden.' : '尚未隐藏任何文件夹。'}
                          </p>
                        )}
                        {settings.hiddenWorkspacePaths.map((path) => (
                          <div className="settings-path-row" key={path}>
                            <span title={path}>{path}</span>
                            <button
                              className="icon-btn sm"
                              aria-label={en ? `Show ${path}` : `取消隐藏 ${path}`}
                              onClick={() =>
                                onChange({
                                  hiddenWorkspacePaths: settings.hiddenWorkspacePaths.filter(
                                    (item) => item !== path,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className="secondary-btn"
                        disabled={settings.hiddenWorkspacePaths.length >= 64}
                        onClick={async () => {
                          const result = await desktop.pickFolder()
                          if (!result || settings.hiddenWorkspacePaths.includes(result.path)) return
                          onChange({
                            hiddenWorkspacePaths: [
                              ...settings.hiddenWorkspacePaths,
                              result.path,
                            ].slice(0, 64),
                          })
                        }}
                      >
                        {en ? 'Choose folder…' : '选择文件夹…'}
                      </button>
                    </SettingsCard>
                  </>
                )}
              </SettingsPage>
            )}

            {section === 'attachments' && (
              <SettingsPage
                title={en ? 'Images and attachments' : '图片与附件'}
                description={
                  en
                    ? 'Control where pasted files live and how they resolve.'
                    : '管理粘贴图片的存放位置与解析规则。'
                }
              >
                <SettingsCard>
                  <SettingRow label={t('附件存放方式')}>
                    <select
                      value={settings.attachmentMode}
                      onChange={(event) =>
                        onChange({
                          attachmentMode: event.target.value as AppSettings['attachmentMode'],
                        })
                      }
                    >
                      <option value="subfolder">{t('文档同级子文件夹')}</option>
                      <option value="docSubfolder">{t('文档同级·按文档名分文件夹')}</option>
                      <option value="same">{t('与文档相同目录')}</option>
                      <option value="vault">{t('仓库根目录')}</option>
                      <option value="vaultSubfolder">{t('仓库根的子文件夹')}</option>
                    </select>
                  </SettingRow>
                  {usesFolder && (
                    <SettingRow label={t('子文件夹名称')}>
                      <input
                        type="text"
                        value={settings.attachmentFolder}
                        placeholder="assets"
                        onChange={(event) =>
                          onChange({ attachmentFolder: event.target.value || 'assets' })
                        }
                      />
                    </SettingRow>
                  )}
                  <p className="settings-hint">
                    {en
                      ? `Markdown path example: ${sample[settings.attachmentMode]}`
                      : `写入 Markdown 的路径示例：${sample[settings.attachmentMode]}`}
                  </p>
                  <SettingRow label={t('图片最大显示宽度')}>
                    <span className="settings-inline">
                      <input
                        type="number"
                        min={0}
                        max={10_000}
                        step={50}
                        value={settings.imageMaxWidth}
                        onChange={(event) =>
                          onChange({ imageMaxWidth: Number(event.target.value) || 0 })
                        }
                      />
                      <span className="settings-unit">{t('px（0 = 不限制）')}</span>
                    </span>
                  </SettingRow>
                  <ToggleRow
                    label={t('文件树中隐藏附件文件夹')}
                    description={t(
                      '勾选后，文件树不显示与「子文件夹名称」同名的目录（不影响文件实际存储）。',
                    )}
                    checked={settings.hideAttachmentFolders}
                    onChange={(checked) => onChange({ hideAttachmentFolders: checked })}
                  />
                </SettingsCard>
                <SettingsCard title={t('额外图片搜索目录')}>
                  <textarea
                    className="settings-textarea"
                    rows={5}
                    value={settings.assetSearchPaths.join('\n')}
                    placeholder="/path/to/static\n/path/to/public"
                    onChange={(event) =>
                      onChange({
                        assetSearchPaths: event.target.value
                          .split('\n')
                          .map((path) => path.trim())
                          .filter(Boolean)
                          .slice(0, 32),
                      })
                    }
                  />
                  <p className="settings-hint">
                    {t(
                      '图片无法在文档目录找到时，依次搜索这里列出的目录（每行一个绝对路径）。适用于图片统一存放在与文档不同层级的情况。',
                    )}
                  </p>
                </SettingsCard>
              </SettingsPage>
            )}

            {section === 'word' && (
              <PandocSettingsPage settings={settings} onChange={onChange} en={en} />
            )}

            {section === 'shortcuts' && (
              <Shortcuts
                overrides={settings.shortcuts}
                onChange={(shortcuts) => onChange({ shortcuts })}
              />
            )}

            {section === 'updates' && (
              <SettingsPage
                title={en ? 'Software updates' : '软件更新'}
                description={
                  en
                    ? 'Keep Xiangzi MD up to date automatically.'
                    : '自动检查并安装 Xiangzi MD 的最新版本。'
                }
              >
                <SettingsCard>
                  <ToggleRow
                    label={en ? 'Check when Xiangzi MD starts' : '启动时自动检查更新'}
                    description={
                      en
                        ? 'The check runs in the background and never blocks startup.'
                        : '后台检查，不阻塞编辑器启动。'
                    }
                    checked={settings.checkUpdatesOnStartup}
                    onChange={(checked) => onChange({ checkUpdatesOnStartup: checked })}
                  />
                  <div className="update-settings-row">
                    <div>
                      <strong>
                        {en ? `Current version ${appVersion}` : `当前版本 ${appVersion}`}
                      </strong>
                      <p aria-live="polite">{updateStatusText(updater, en)}</p>
                    </div>
                    <button
                      className="secondary-btn"
                      disabled={
                        updater.state.phase === 'checking' || updater.state.phase === 'downloading'
                      }
                      onClick={() => void updater.checkNow(true)}
                    >
                      <RefreshCw
                        size={14}
                        className={updater.state.phase === 'checking' ? 'spin' : ''}
                      />
                      {en ? 'Check now' : '立即检查'}
                    </button>
                  </div>
                </SettingsCard>
              </SettingsPage>
            )}

            {section === 'about' && (
              <SettingsPage title={en ? 'About Xiangzi MD' : '关于 Xiangzi MD'}>
                <div className="about-card">
                  <div className="about-logo" aria-hidden="true">
                    <PenLine size={24} />
                  </div>
                  <div>
                    <h2>Xiangzi MD</h2>
                    <p>v{appVersion}</p>
                  </div>
                </div>
                <SettingsCard>
                  <p className="about-description">
                    {en
                      ? 'A local-first WYSIWYG Markdown editor. Your files stay on your device, with no account required.'
                      : '本地优先、所见即所得的 Markdown 编辑器。文件保存在你的设备中，无需注册账号。'}
                  </p>
                  <div className="about-update-row">
                    <div>
                      <strong>
                        {en ? `Current version ${appVersion}` : `当前版本 ${appVersion}`}
                      </strong>
                      <p aria-live="polite">{updateStatusText(updater, en)}</p>
                    </div>
                    <button
                      className="secondary-btn"
                      disabled={
                        updater.state.phase === 'checking' || updater.state.phase === 'downloading'
                      }
                      onClick={() => void updater.checkNow(true)}
                    >
                      <RefreshCw
                        size={14}
                        className={updater.state.phase === 'checking' ? 'spin' : ''}
                      />
                      {en ? 'Check for updates' : '检查更新'}
                    </button>
                  </div>
                </SettingsCard>
                <section className="about-resources" aria-labelledby="about-resources-title">
                  <h3 id="about-resources-title">{en ? 'Resources' : '常用资源'}</h3>
                  <div className="about-resource-list">
                    {[
                      [ABOUT_LINKS.guide, BookOpen, en ? 'User guide' : '使用指南'],
                      [ABOUT_LINKS.releases, ScrollText, en ? 'Release notes' : '更新日志'],
                      [ABOUT_LINKS.feedback, Bug, en ? 'Feedback' : '问题反馈'],
                    ].map(([url, Icon, label]) => (
                      <button
                        key={String(url)}
                        className="about-resource-row"
                        onClick={() => void desktop.openExternal(String(url))}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>{String(label)}</span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="about-support-card">
                  <div className="about-support-icon" aria-hidden="true">
                    <HeartHandshake size={20} />
                  </div>
                  <div className="about-support-copy">
                    <h3>{en ? 'Support Xiangzi MD' : '支持 Xiangzi MD'}</h3>
                    <p>
                      {en
                        ? 'If Xiangzi MD saves you time, you can support its continued development.'
                        : '如果 Xiangzi MD 为你节省了时间，欢迎支持项目持续更新。'}
                    </p>
                  </div>
                  <button className="primary-btn" onClick={() => setSupportOpen(true)}>
                    {en ? 'Support' : '支持项目'}
                  </button>
                </section>
                <nav
                  className="about-legal-links"
                  aria-label={en ? 'Legal and project links' : '法律与项目链接'}
                >
                  <button onClick={() => setLicenseOpen(true)}>
                    {en ? 'Open-source license' : '开源许可'}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button onClick={() => void desktop.openExternal(ABOUT_LINKS.privacy)}>
                    {en ? 'Privacy' : '隐私说明'}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button onClick={() => void desktop.openExternal(ABOUT_LINKS.project)}>
                    {en ? 'GitHub project' : 'GitHub 项目主页'}
                  </button>
                </nav>
                <p className="about-copyright">
                  © {new Date().getFullYear()} guoxiangzi · MIT License
                </p>
              </SettingsPage>
            )}
          </div>
        </div>
      </section>
      {licenseOpen && (
        <div
          className="modal-backdrop license-backdrop"
          onClick={(event) => {
            event.stopPropagation()
            setLicenseOpen(false)
          }}
        >
          <section
            className="modal license-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="license-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <span id="license-title">{en ? 'Open-source license' : '开源许可'}</span>
              <button
                className="icon-btn sm"
                aria-label={en ? 'Close license' : '关闭许可'}
                onClick={() => setLicenseOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="license-content">
              <h2>MIT License</h2>
              <p>
                {en
                  ? 'You may use, copy, modify, distribute, and commercially use this software. The original copyright and license notice must be retained.'
                  : '你可以使用、复制、修改、分发及商业使用本软件，但必须保留原始版权和许可声明。'}
              </p>
              <pre>{licenseText.trim()}</pre>
            </div>
          </section>
        </div>
      )}
      {supportOpen && (
        <div
          className="modal-backdrop support-backdrop"
          onClick={(event) => {
            event.stopPropagation()
            setSupportOpen(false)
          }}
        >
          <section
            className="modal support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <span id="support-title">{en ? 'Support Xiangzi MD' : '支持 Xiangzi MD'}</span>
              <button
                className="icon-btn sm"
                aria-label={en ? 'Close support options' : '关闭支持方式'}
                onClick={() => setSupportOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="support-content">
              <p className="support-intro">
                {en
                  ? 'Xiangzi MD is independently developed and maintained by guoxiangzi. If it saves you time, you can voluntarily support its continued development.'
                  : 'Xiangzi MD 由 guoxiangzi 独立开发和维护。如果它为你节省了时间，欢迎自愿支持项目持续更新。'}
              </p>
              <div className="support-options">
                <article className="support-option support-option-alipay">
                  <h3>{en ? 'Alipay' : '支付宝'}</h3>
                  <div className="support-qr-crop support-qr-crop-alipay">
                    <img
                      src={alipaySupportQr}
                      alt={en ? 'Alipay support QR code' : '支付宝支持二维码'}
                    />
                  </div>
                  <p>{en ? 'Scan with Alipay' : '使用支付宝扫码支持'}</p>
                </article>
                <article className="support-option support-option-wechat">
                  <h3>{en ? 'WeChat Pay' : '微信支付'}</h3>
                  <div className="support-qr-crop support-qr-crop-wechat">
                    <img
                      src={wechatSupportQr}
                      alt={en ? 'WeChat Pay support QR code' : '微信支付支持二维码'}
                    />
                  </div>
                  <p>{en ? 'Scan with WeChat' : '使用微信扫码支持'}</p>
                </article>
                <article className="support-option support-option-paypal">
                  <h3>PayPal</h3>
                  <img src={paypalSupportQr} alt="PayPal support QR code" />
                  <button
                    className="secondary-btn"
                    onClick={() => void desktop.openExternal(PAYPAL_SUPPORT_URL)}
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    {en ? 'Open PayPal' : '打开 PayPal'}
                  </button>
                </article>
              </div>
              <p className="support-note">
                {en
                  ? 'Support is voluntary and does not purchase software, a subscription, feature delivery, or technical support.'
                  : '支持是自愿行为，不构成软件购买、订阅、功能交付或技术支持承诺。'}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function SettingsPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="settings-page">
      <div className="settings-page-title">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}

function SettingsCard({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: ReactNode
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="settings-row">
      {description ? (
        <span>
          <span className="settings-label">{label}</span>
          <small>{description}</small>
        </span>
      ) : (
        <span className="settings-label">{label}</span>
      )}
      {children}
    </label>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className={`settings-row settings-toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span>
        <span className="settings-label">{label}</span>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function HiddenNamePatterns({
  patterns,
  onChange,
  en,
}: {
  patterns: string[]
  onChange: (next: string[]) => void
  en: boolean
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || patterns.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...patterns, trimmed])
    setDraft('')
  }

  return (
    <div className="hidden-name-patterns">
      <div className="name-pattern-tags">
        {patterns.map((p) => (
          <span key={p} className="name-pattern-tag">
            {p}
            <button
              className="name-pattern-remove"
              aria-label={en ? `Remove ${p}` : `移除 ${p}`}
              onClick={() => onChange(patterns.filter((x) => x !== p))}
            >
              ×
            </button>
          </span>
        ))}
        {patterns.length === 0 && (
          <span className="settings-empty-text">{en ? 'No patterns.' : '暂无规则。'}</span>
        )}
      </div>
      <div className="name-pattern-input-row">
        <input
          className="input-dialog-field name-pattern-input"
          placeholder={en ? 'e.g. dist, .next, *.log' : '例如 dist、.next、*.log'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="secondary-btn" onClick={add} disabled={!draft.trim()}>
          {en ? 'Add' : '添加'}
        </button>
      </div>
    </div>
  )
}

function PandocSettingsPage({
  settings,
  onChange,
  en,
}: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
}): JSX.Element {
  const [pandocStatus, setPandocStatus] = useState<PandocStatus | null | undefined>(undefined)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setPandocStatus(undefined)
    const timer = window.setTimeout(() => {
      void desktop
        .pandocStatus()
        .then((status) => setPandocStatus(status))
        .catch(() => setPandocStatus(null))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [settings.pandocPath, refreshKey])

  const choosePandoc = async (): Promise<void> => {
    const result = await desktop.pickPandocExecutable()
    if (result) onChange({ pandocPath: result.path })
  }

  const chooseTemplate = async (): Promise<void> => {
    const result = await desktop.pickWordTemplate()
    if (result) onChange({ pandocReferenceDoc: result.path })
  }

  const exportDefaultTemplate = async (): Promise<void> => {
    try {
      const result = await desktop.savePandocDefaultTemplate()
      if (result) onChange({ pandocReferenceDoc: result.path })
    } catch (error) {
      await desktop.notify(
        (en ? 'Could not export the default Word template:\n' : '默认 Word 模板导出失败：\n') +
          (error as Error).message,
      )
    }
  }

  return (
    <SettingsPage
      title={en ? 'Word / Pandoc' : 'Word / Pandoc'}
      description={
        en
          ? 'Configure Word import, export, templates, and advanced Pandoc options.'
          : '配置 Word 导入、导出、模板与 Pandoc 高级参数。'
      }
    >
      <SettingsCard title={en ? 'Pandoc installation' : 'Pandoc 程序'}>
        <div className="pandoc-status-row" aria-live="polite">
          <div>
            <strong>
              {pandocStatus === undefined
                ? en
                  ? 'Checking…'
                  : '正在检测…'
                : pandocStatus
                  ? `Pandoc ${pandocStatus.version}`
                  : en
                    ? 'Pandoc not found'
                    : '未检测到 Pandoc'}
            </strong>
            <p>
              {pandocStatus?.path ||
                (en
                  ? 'Word import and export require Pandoc.'
                  : 'Word 导入和导出需要安装 Pandoc。')}
            </p>
          </div>
          <span
            className={`pandoc-status-badge ${pandocStatus ? 'available' : pandocStatus === null ? 'missing' : ''}`}
          >
            {pandocStatus === undefined
              ? en
                ? 'Checking'
                : '检测中'
              : pandocStatus
                ? en
                  ? 'Available'
                  : '可用'
                : en
                  ? 'Unavailable'
                  : '不可用'}
          </span>
        </div>
        <SettingRow label={en ? 'Executable path' : '程序路径'}>
          <input
            type="text"
            value={settings.pandocPath}
            placeholder={en ? 'Auto-detect' : '留空自动检测'}
            onChange={(event) => onChange({ pandocPath: event.target.value })}
          />
        </SettingRow>
        <div className="pandoc-actions">
          {settings.pandocPath && (
            <button className="secondary-btn" onClick={() => onChange({ pandocPath: '' })}>
              {en ? 'Auto-detect' : '恢复自动检测'}
            </button>
          )}
          <button className="secondary-btn" onClick={() => void choosePandoc()}>
            {en ? 'Choose executable…' : '选择程序…'}
          </button>
          <button className="secondary-btn" onClick={() => setRefreshKey((value) => value + 1)}>
            {en ? 'Check again' : '重新检测'}
          </button>
          {!pandocStatus && pandocStatus !== undefined && (
            <button
              className="secondary-btn"
              onClick={() => void desktop.openExternal('https://pandoc.org/installing.html')}
            >
              {en ? 'Download Pandoc' : '下载 Pandoc'}
            </button>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={en ? 'Word template' : 'Word 模板'}>
        <div className="settings-file-picker">
          <div>
            <strong>
              {settings.pandocReferenceDoc
                ? en
                  ? 'Custom template'
                  : '自定义模板'
                : en
                  ? 'Built-in default template'
                  : '内置默认模板'}
            </strong>
            <p>
              {settings.pandocReferenceDoc ||
                (en ? 'Pandoc reference.docx' : 'Pandoc 内置 reference.docx')}
            </p>
          </div>
          <span className="settings-inline">
            {settings.pandocReferenceDoc && (
              <button
                className="secondary-btn"
                onClick={() => onChange({ pandocReferenceDoc: '' })}
              >
                {en ? 'Use default' : '恢复默认'}
              </button>
            )}
            <button className="secondary-btn" onClick={() => void chooseTemplate()}>
              {settings.pandocReferenceDoc ? (en ? 'Replace…' : '更换…') : en ? 'Choose…' : '选择…'}
            </button>
          </span>
        </div>
        <button
          className="secondary-btn pandoc-template-export"
          disabled={!pandocStatus}
          onClick={() => void exportDefaultTemplate()}
        >
          {en ? 'Export and use an editable default copy…' : '导出并使用可编辑的默认模板副本…'}
        </button>
        <p className="settings-hint">
          {en
            ? 'Edit the copied DOCX styles in Word, then keep it selected here.'
            : '可以在 Word 中修改副本的样式；保存后继续在这里使用该文件。'}
        </p>
      </SettingsCard>

      <SettingsCard title={en ? 'Export behavior' : '导出行为'}>
        <ToggleRow
          label={en ? 'Generate table of contents' : '生成目录'}
          description={en ? 'Insert a Word table of contents.' : '在 Word 文档中插入目录。'}
          checked={settings.pandocToc}
          onChange={(pandocToc) => onChange({ pandocToc })}
        />
        <ToggleRow
          label={en ? 'Number headings' : '标题自动编号'}
          description={
            en ? 'Number document sections during export.' : '导出时为章节标题生成编号。'
          }
          checked={settings.pandocNumberSections}
          onChange={(pandocNumberSections) => onChange({ pandocNumberSections })}
        />
        <ToggleRow
          label={en ? 'Normalize Chinese fonts' : '规范中文字体'}
          description={
            en
              ? 'Use SimSun for body text, SimHei for headings, and black heading colors.'
              : '正文使用宋体、标题使用黑体，并将标题颜色设为黑色；关闭后完整保留自定义模板样式。'
          }
          checked={settings.pandocNormalizeFonts}
          onChange={(pandocNormalizeFonts) => onChange({ pandocNormalizeFonts })}
        />
      </SettingsCard>

      <SettingsCard title={en ? 'Import behavior' : '导入行为'}>
        <SettingRow label={en ? 'Media folder' : '图片目录'}>
          <input
            type="text"
            value={settings.pandocMediaFolder}
            placeholder="assets"
            onChange={(event) => onChange({ pandocMediaFolder: event.target.value || 'assets' })}
          />
        </SettingRow>
        <p className="settings-hint">
          {en
            ? 'Images extracted from Word are stored beside the imported Markdown file.'
            : '从 Word 提取的图片会存放在导入后 Markdown 文件同级的这个目录中。'}
        </p>
      </SettingsCard>

      <SettingsCard title={en ? 'Advanced arguments' : '高级参数'}>
        <label className="pandoc-args-field">
          <span>{en ? 'Export arguments' : '导出附加参数'}</span>
          <textarea
            className="settings-textarea"
            rows={3}
            value={settings.pandocExportArgs}
            placeholder="--highlight-style=tango --metadata lang=zh-CN"
            onChange={(event) => onChange({ pandocExportArgs: event.target.value })}
          />
        </label>
        <label className="pandoc-args-field">
          <span>{en ? 'Import arguments' : '导入附加参数'}</span>
          <textarea
            className="settings-textarea"
            rows={3}
            value={settings.pandocImportArgs}
            placeholder="--track-changes=accept"
            onChange={(event) => onChange({ pandocImportArgs: event.target.value })}
          />
        </label>
        <p className="settings-hint">
          {en
            ? 'Quotes are supported. Input/output formats, output paths, media paths, and reference templates are managed above.'
            : '支持单双引号；输入输出格式、输出路径、媒体目录和模板参数由上方设置统一管理。'}
        </p>
      </SettingsCard>
    </SettingsPage>
  )
}

function updateStatusText(updater: UpdaterController, en: boolean): string {
  const { state } = updater
  if (state.phase === 'checking') return en ? 'Checking for updates…' : '正在检查新版本…'
  if (state.phase === 'up-to-date') return en ? 'You are up to date.' : '当前已经是最新版本。'
  if (state.phase === 'available')
    return en ? `Version ${state.version} is available.` : `发现新版本 ${state.version}。`
  if (state.phase === 'downloading') return en ? 'Downloading the update…' : '正在下载更新…'
  if (state.phase === 'error')
    return en ? 'Could not check for updates. Try again later.' : '暂时无法检查更新，请稍后重试。'
  return en ? 'Not checked yet.' : '尚未检查。'
}
