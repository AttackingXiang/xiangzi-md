import { ExternalLink, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktop } from '../../platform'
import type { InstalledTheme } from '../../platform/contracts'
import type { AppSettings } from '../../types'
import { t } from '../../lib/i18n'
import { THEME_GALLERY_URL } from '../../lib/themeMarketplace'
import { SettingsPage, SettingsCard, SettingRow } from './primitives'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
  customCssError: boolean
  backgroundImageError: boolean
}

export default function AppearanceSection({
  settings,
  onChange,
  en,
  customCssError,
  backgroundImageError,
}: Props): JSX.Element {
  const [installedThemes, setInstalledThemes] = useState<InstalledTheme[]>([])
  const [themesLoading, setThemesLoading] = useState(true)
  const [themeManagerOpen, setThemeManagerOpen] = useState(false)
  const [removingThemeId, setRemovingThemeId] = useState<string | null>(null)
  const [themeActionError, setThemeActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setThemesLoading(true)
    void desktop
      .listInstalledThemes()
      .then((themes) => {
        if (!cancelled) {
          setInstalledThemes(themes)
          setThemeActionError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInstalledThemes([])
          const detail = error instanceof Error ? error.message : String(error)
          setThemeActionError(
            en ? `Could not load local themes: ${detail}` : `无法读取本地主题：${detail}`,
          )
        }
      })
      .finally(() => {
        if (!cancelled) setThemesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [en, settings.customCssPath])

  useEffect(() => {
    if (!themeManagerOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setThemeManagerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [themeManagerOpen])

  const installedTheme = installedThemes.find((theme) => theme.cssPath === settings.customCssPath)
  const themeValue = installedTheme
    ? `installed:${installedTheme.id}`
    : settings.customCssPath
      ? 'local'
      : `builtin:${settings.theme}`

  const removeInstalledTheme = async (theme: InstalledTheme): Promise<void> => {
    if (removingThemeId) return

    setThemeActionError(null)
    setRemovingThemeId(theme.id)
    try {
      await desktop.removeInstalledTheme(theme.id)
      setInstalledThemes((themes) => themes.filter((item) => item.id !== theme.id))
      if (settings.customCssPath === theme.cssPath) {
        onChange({ theme: theme.colorScheme, customCssPath: '' })
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setThemeActionError(
        en ? `Could not uninstall the theme: ${detail}` : `主题卸载失败：${detail}`,
      )
    } finally {
      setRemovingThemeId(null)
    }
  }

  return (
    <SettingsPage
      title={en ? 'Appearance' : '外观'}
      description={en ? 'Keep the workspace calm and readable.' : '保持工作区清爽、稳定且易读。'}
    >
      <SettingsCard title={en ? 'Interface' : '界面'}>
        <p className="appearance-group-description">
          {en
            ? 'Choose the language used across Xiangzi MD.'
            : '设置 Xiangzi MD 整体界面的显示语言。'}
        </p>
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
      </SettingsCard>

      <SettingsCard title={en ? 'Themes' : '主题'}>
        <p className="appearance-group-description">
          {en
            ? 'Choose a theme and manage themes installed from the gallery.'
            : '选择当前主题，并管理从主题库安装到本机的主题。'}
        </p>
        <SettingRow label={t('主题')}>
          <select
            id="settings-theme-select"
            className="settings-theme-select"
            value={themeValue}
            onChange={(event) => {
              setThemeActionError(null)
              const value = event.target.value
              if (value.startsWith('builtin:')) {
                onChange({
                  theme: value.slice('builtin:'.length) as AppSettings['theme'],
                  customCssPath: '',
                })
                return
              }
              if (value.startsWith('installed:')) {
                const selected = installedThemes.find(
                  (theme) => theme.id === value.slice('installed:'.length),
                )
                if (selected) {
                  onChange({ theme: selected.colorScheme, customCssPath: selected.cssPath })
                }
              }
            }}
          >
            <optgroup label={en ? 'Built-in themes' : '内置主题'}>
              <option value="builtin:system">{t('跟随系统')}</option>
              <option value="builtin:light">{t('浅色')}</option>
              <option value="builtin:dark">{t('深色')}</option>
              <option value="builtin:warm">{t('暖色')}</option>
              <option value="builtin:mint">{t('浅绿')}</option>
              <option value="builtin:blue">{t('蓝调')}</option>
              <option value="builtin:summer">{t('夏日')}</option>
              <option value="builtin:sakura">{t('樱粉')}</option>
            </optgroup>
            {installedThemes.length > 0 && (
              <optgroup label={en ? 'Installed themes' : '已安装主题'}>
                {installedThemes.map((theme) => (
                  <option key={theme.id} value={`installed:${theme.id}`}>
                    {theme.name} · {theme.version}
                  </option>
                ))}
              </optgroup>
            )}
            {settings.customCssPath && !installedTheme && (
              <option value="local">{en ? 'Local custom CSS' : '本地自定义 CSS'}</option>
            )}
          </select>
        </SettingRow>
        <div className="settings-row settings-theme-gallery-row">
          <span className="settings-label">{en ? 'Theme gallery' : '更多主题'}</span>
          <button
            type="button"
            className="secondary-btn settings-more-themes"
            onClick={() => void desktop.openExternal(THEME_GALLERY_URL)}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {en ? 'Browse themes' : '浏览主题库'}
          </button>
        </div>
        <div className="settings-row settings-local-themes-row">
          <span className="settings-label">{en ? 'Local themes' : '本地主题'}</span>
          <button
            type="button"
            className="secondary-btn settings-manage-themes"
            onClick={() => setThemeManagerOpen(true)}
          >
            <Trash2 size={14} aria-hidden="true" />
            {en ? 'Uninstall themes' : '卸载主题'}
            {!themesLoading && installedThemes.length > 0 && ` (${installedThemes.length})`}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={en ? 'Reading details' : '阅读细节'}>
        <p className="appearance-group-description">
          {en
            ? 'Fine-tune the editor canvas and content surfaces.'
            : '微调编辑区域宽度与内容表面的显示效果。'}
        </p>
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
              min={-10}
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
              onChange={(event) => onChange({ codeBlockOpacity: Number(event.target.value) })}
            />
            <small>{settings.codeBlockOpacity}%</small>
          </span>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={en ? 'Background & custom styling' : '背景与自定义'}>
        <p className="appearance-group-description">
          {en
            ? 'Add a background image or load local CSS for advanced styling.'
            : '添加背景图片，或加载本地 CSS 进行高级样式定制。'}
        </p>
        <section className="appearance-subsection">
          <h4>{t('背景图片')}</h4>
          <div className="settings-file-picker">
            <div>
              <p>
                {settings.backgroundImagePath || (en ? 'No background image' : '未设置背景图片')}
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
                  onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
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
        </section>
        <section className="appearance-subsection">
          <h4>{en ? 'Local theme CSS' : '本地主题 CSS'}</h4>
          <div className="settings-file-picker">
            <div>
              <p>
                {installedTheme
                  ? `${installedTheme.name} · ${installedTheme.author}`
                  : settings.customCssPath || (en ? 'No local CSS selected' : '未选择本地 CSS')}
              </p>
            </div>
            <span className="settings-inline">
              {settings.customCssPath && (
                <button className="secondary-btn" onClick={() => onChange({ customCssPath: '' })}>
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
        </section>
      </SettingsCard>

      {themeManagerOpen && (
        <div
          className="modal-backdrop theme-manager-backdrop"
          onClick={(event) => {
            event.stopPropagation()
            setThemeManagerOpen(false)
          }}
        >
          <section
            className="modal theme-manager-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="theme-manager-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <span id="theme-manager-title">{en ? 'Uninstall local themes' : '卸载本地主题'}</span>
              <button
                type="button"
                className="icon-btn sm"
                aria-label={en ? 'Close local theme manager' : '关闭本地主题管理'}
                onClick={() => setThemeManagerOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="theme-manager-content">
              <p className="theme-manager-intro">
                {en
                  ? 'Themes installed from the Xiangzi MD gallery are stored on this device.'
                  : '这里列出从 Xiangzi MD 主题库安装到本机的全部主题。'}
              </p>
              {themesLoading ? (
                <div className="theme-manager-empty" aria-live="polite">
                  <LoaderCircle size={16} className="spin" aria-hidden="true" />
                  {en ? 'Loading local themes…' : '正在读取本地主题…'}
                </div>
              ) : installedThemes.length > 0 ? (
                <div className="theme-manager-list">
                  {installedThemes.map((theme) => (
                    <article className="theme-manager-item" key={theme.id}>
                      <div className="theme-manager-copy">
                        <strong>{theme.name}</strong>
                        <span>
                          {theme.author} · {theme.version}
                          {settings.customCssPath === theme.cssPath
                            ? en
                              ? ' · Active'
                              : ' · 使用中'
                            : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-btn theme-manager-delete"
                        data-theme-id={theme.id}
                        disabled={removingThemeId !== null}
                        onClick={() => void removeInstalledTheme(theme)}
                      >
                        {removingThemeId === theme.id ? (
                          <LoaderCircle size={14} className="spin" aria-hidden="true" />
                        ) : (
                          <Trash2 size={14} aria-hidden="true" />
                        )}
                        {removingThemeId === theme.id
                          ? en
                            ? 'Deleting…'
                            : '正在删除…'
                          : en
                            ? 'Delete'
                            : '删除'}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="theme-manager-empty">
                  {en ? 'No local themes are installed.' : '当前没有已安装的本地主题。'}
                </div>
              )}
              {themeActionError && (
                <p className="settings-error" role="alert">
                  {themeActionError}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </SettingsPage>
  )
}
