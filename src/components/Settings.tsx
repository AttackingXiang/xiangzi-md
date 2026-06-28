import {
  FileImage,
  Info,
  Keyboard,
  Palette,
  PenLine,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { desktop } from '../platform'
import type { AppSettings } from '../types'
import type { UpdaterController } from '../hooks/useUpdater'
import Shortcuts from './Shortcuts'
import { getLang, t } from '../lib/i18n'

export type SettingsSection =
  | 'appearance'
  | 'editor'
  | 'attachments'
  | 'shortcuts'
  | 'updates'
  | 'about'

interface Props {
  settings: AppSettings
  updater: UpdaterController
  initialSection?: SettingsSection
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
}

export default function Settings({
  settings,
  updater,
  initialSection = 'appearance',
  onChange,
  onClose,
}: Props): JSX.Element {
  const en = getLang() === 'en'
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [appVersion, setAppVersion] = useState('—')
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
    { id: 'attachments', label: en ? 'Images' : '图片与附件', icon: FileImage },
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
                </SettingsCard>
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
                    ? 'Signed packages with an automatic Gitee fallback.'
                    : '仅安装签名包，并在 GitHub 不可用时自动切换 Gitee。'
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
                <div className="settings-security-note">
                  <ShieldCheck size={18} />
                  <p>
                    {en
                      ? 'Every downloaded update is verified with the embedded signing public key before installation.'
                      : '每个更新包在安装前都会使用应用内置公钥校验签名。'}
                  </p>
                </div>
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
                      ? 'A local-first WYSIWYG Markdown editor built with Tauri.'
                      : '基于 Tauri 构建的本地优先、所见即所得 Markdown 编辑器。'}
                  </p>
                </SettingsCard>
              </SettingsPage>
            )}
          </div>
        </div>
      </section>
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

function SettingRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </label>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="settings-row settings-toggle-row">
      <span>
        <span className="settings-label">{label}</span>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function updateStatusText(updater: UpdaterController, en: boolean): string {
  const { state } = updater
  if (state.phase === 'checking')
    return en
      ? 'Checking GitHub, with Gitee as fallback…'
      : '正在检查 GitHub，失败时自动切换 Gitee…'
  if (state.phase === 'up-to-date') return en ? 'You are up to date.' : '当前已经是最新版本。'
  if (state.phase === 'available')
    return en ? `Version ${state.version} is available.` : `发现新版本 ${state.version}。`
  if (state.phase === 'downloading')
    return en ? 'Downloading the signed package…' : '正在下载签名更新包…'
  if (state.phase === 'error')
    return en ? 'Could not reach either update source.' : 'GitHub 与 Gitee 暂时都无法访问。'
  return en ? 'Not checked yet.' : '尚未检查。'
}
