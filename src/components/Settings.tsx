import {
  FileImage,
  FileType2,
  Files,
  Info,
  Keyboard,
  PanelBottom,
  Palette,
  PenLine,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktop } from '../platform'
import type { AppSettings } from '../types'
import type { UpdaterController } from '../hooks/useUpdater'
import Shortcuts from './Shortcuts'
import { getLang, t } from '../lib/i18n'
import AppearanceSection from './settings/AppearanceSection'
import EditorSection from './settings/EditorSection'
import ControlsSection from './settings/ControlsSection'
import FilesSection from './settings/FilesSection'
import AttachmentsSection from './settings/AttachmentsSection'
import PandocSettingsPage from './settings/PandocSettingsPage'
import UpdatesSection from './settings/UpdatesSection'
import AboutSection from './settings/AboutSection'

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

  useEffect(() => {
    void desktop
      .getAppInfo()
      .then((info) => setAppVersion(info.version))
      .catch(() => undefined)
  }, [])

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
              <AppearanceSection
                settings={settings}
                onChange={onChange}
                en={en}
                customCssError={customCssError}
                backgroundImageError={backgroundImageError}
              />
            )}
            {section === 'editor' && (
              <EditorSection settings={settings} onChange={onChange} en={en} />
            )}
            {section === 'controls' && (
              <ControlsSection settings={settings} onChange={onChange} en={en} />
            )}
            {section === 'files' && (
              <FilesSection settings={settings} onChange={onChange} en={en} />
            )}
            {section === 'attachments' && (
              <AttachmentsSection settings={settings} onChange={onChange} en={en} />
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
              <UpdatesSection
                settings={settings}
                onChange={onChange}
                en={en}
                appVersion={appVersion}
                updater={updater}
              />
            )}
            {section === 'about' && (
              <AboutSection appVersion={appVersion} updater={updater} en={en} />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
