import {
  Check,
  ExternalLink,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { desktop } from '../../platform'
import type { InstalledTheme } from '../../platform/contracts'
import type { AppSettings } from '../../types'
import { t } from '../../lib/i18n'
import { THEME_GALLERY_URL } from '../../lib/themeMarketplace'
import {
  DEFAULT_SEARCH_FOCUS_EFFECT,
  normalizeSearchFocusEffect,
  SEARCH_FOCUS_EFFECT_PRESETS,
} from '../../lib/searchFocusEffect'
import { useModalFocus } from '../../hooks/useModalFocus'
import { SettingsPage, SettingsCard, SettingRow } from './primitives'

type BuiltInTheme = {
  value: AppSettings['theme']
  labelZh: string
  labelEn: string
  descriptionZh: string
  descriptionEn: string
  colors: string[]
  icon: typeof Monitor
}

const BUILT_IN_THEMES: BuiltInTheme[] = [
  {
    value: 'system',
    labelZh: '跟随系统',
    labelEn: 'System',
    descriptionZh: '自动匹配系统外观',
    descriptionEn: 'Matches your OS',
    colors: ['#f8f5ed', '#2d2f34', '#6f8f72'],
    icon: Monitor,
  },
  {
    value: 'light',
    labelZh: '浅色',
    labelEn: 'Light',
    descriptionZh: '清爽明亮',
    descriptionEn: 'Clean and bright',
    colors: ['#fbfaf7', '#ece7dc', '#577d86'],
    icon: Sun,
  },
  {
    value: 'dark',
    labelZh: '深色',
    labelEn: 'Dark',
    descriptionZh: '低亮度写作',
    descriptionEn: 'Low-light writing',
    colors: ['#1e2026', '#2f3440', '#9ab3a6'],
    icon: Moon,
  },
  {
    value: 'warm',
    labelZh: '暖色',
    labelEn: 'Warm',
    descriptionZh: '柔和纸感',
    descriptionEn: 'Soft paper tone',
    colors: ['#f7efe4', '#e3d0b8', '#a6634b'],
    icon: Palette,
  },
  {
    value: 'mint',
    labelZh: '浅绿',
    labelEn: 'Mint',
    descriptionZh: '清淡护眼',
    descriptionEn: 'Quiet and fresh',
    colors: ['#f2f8f3', '#d8eadc', '#4f8c72'],
    icon: Palette,
  },
  {
    value: 'blue',
    labelZh: '蓝调',
    labelEn: 'Blue',
    descriptionZh: '冷静专注',
    descriptionEn: 'Calm focus',
    colors: ['#f2f6fb', '#d8e4f0', '#507aa6'],
    icon: Palette,
  },
  {
    value: 'summer',
    labelZh: '夏日',
    labelEn: 'Summer',
    descriptionZh: '轻快明亮',
    descriptionEn: 'Light and vivid',
    colors: ['#fff8dc', '#f4d37d', '#2f9c8f'],
    icon: Sun,
  },
  {
    value: 'sakura',
    labelZh: '樱粉',
    labelEn: 'Sakura',
    descriptionZh: '温柔粉调',
    descriptionEn: 'Gentle pink tone',
    colors: ['#fff3f6', '#f2c6d3', '#b86c84'],
    icon: Palette,
  },
]

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
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [themeManagerOpen, setThemeManagerOpen] = useState(false)
  const [removingThemeId, setRemovingThemeId] = useState<string | null>(null)
  const [themeActionError, setThemeActionError] = useState<string | null>(null)
  const closeThemeManager = useCallback(() => setThemeManagerOpen(false), [])
  const themeManagerDialogRef = useModalFocus<HTMLElement>(themeManagerOpen, closeThemeManager)

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

  const installedTheme = installedThemes.find((theme) => theme.cssPath === settings.customCssPath)
  const themeValue = installedTheme
    ? `installed:${installedTheme.id}`
    : settings.customCssPath
      ? 'local'
      : `builtin:${settings.theme}`
  const selectedBuiltInTheme = BUILT_IN_THEMES.find((theme) => theme.value === settings.theme)
  const selectedThemeName =
    installedTheme?.name ??
    (settings.customCssPath
      ? en
        ? 'Local custom CSS'
        : '本地自定义 CSS'
      : BUILT_IN_THEMES.find((theme) => theme.value === settings.theme)?.[
          en ? 'labelEn' : 'labelZh'
        ]) ??
    (en ? 'Custom CSS' : '自定义 CSS')
  const currentThemeColors = installedTheme
    ? installedTheme.colorScheme === 'dark'
      ? ['#20242b', '#353b45', '#aeb8c8']
      : ['#fbfaf8', '#ebe7de', '#8a8f75']
    : settings.customCssPath
      ? ['#f8f5ed', '#d7cec0', '#4f6f73']
      : (selectedBuiltInTheme?.colors ?? BUILT_IN_THEMES[0].colors)
  const searchFocusEffect = normalizeSearchFocusEffect(
    settings.searchFocusEffect ?? DEFAULT_SEARCH_FOCUS_EFFECT,
  )
  const searchFocusPreset = SEARCH_FOCUS_EFFECT_PRESETS[searchFocusEffect]

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
            ? 'Choose the language and how much horizontal room the editor uses.'
            : '设置界面语言，以及编辑区域使用的横向空间。'}
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

      <SettingsCard title={en ? 'Themes' : '主题'}>
        <p className="appearance-group-description">
          {en
            ? 'Pick the workspace color system, then fine-tune surfaces and code blocks.'
            : '选择工作区的配色系统，并微调主题底色与代码块表面。'}
        </p>
        <div className="theme-current-panel">
          <div className="theme-current-summary">
            <span className="theme-choice-swatch" aria-hidden="true">
              {currentThemeColors.map((color) => (
                <span key={color} style={{ backgroundColor: color }} />
              ))}
            </span>
            <span className="theme-choice-copy">
              <strong>{selectedThemeName}</strong>
              <small>{en ? 'Current theme' : '当前主题'}</small>
            </span>
          </div>
          <button
            type="button"
            className="secondary-btn theme-current-change"
            aria-expanded={themePickerOpen}
            onClick={() => setThemePickerOpen((open) => !open)}
          >
            {themePickerOpen ? (en ? 'Done' : '完成') : en ? 'Change…' : '更换…'}
          </button>
        </div>
        {themePickerOpen && (
          <div className="theme-picker-panel">
            <div className="theme-choice-grid" role="radiogroup" aria-label={en ? 'Theme' : '主题'}>
              {BUILT_IN_THEMES.map((theme) => {
                const Icon = theme.icon
                const active = themeValue === `builtin:${theme.value}`
                return (
                  <button
                    key={theme.value}
                    type="button"
                    className={`theme-choice-card${active ? ' is-active' : ''}`}
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setThemeActionError(null)
                      onChange({ theme: theme.value, customCssPath: '' })
                      setThemePickerOpen(false)
                    }}
                  >
                    <span className="theme-choice-swatch" aria-hidden="true">
                      {theme.colors.map((color) => (
                        <span key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="theme-choice-copy">
                      <strong>
                        <Icon size={14} aria-hidden="true" />
                        {en ? theme.labelEn : theme.labelZh}
                      </strong>
                      <small>{en ? theme.descriptionEn : theme.descriptionZh}</small>
                    </span>
                    {active && (
                      <Check size={14} className="theme-choice-check" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
              {installedThemes.map((theme) => {
                const active = themeValue === `installed:${theme.id}`
                const colors =
                  theme.colorScheme === 'dark'
                    ? ['#20242b', '#353b45', '#aeb8c8']
                    : ['#fbfaf8', '#ebe7de', '#8a8f75']
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className={`theme-choice-card theme-choice-card-installed${active ? ' is-active' : ''}`}
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setThemeActionError(null)
                      onChange({ theme: theme.colorScheme, customCssPath: theme.cssPath })
                      setThemePickerOpen(false)
                    }}
                  >
                    <span className="theme-choice-swatch" aria-hidden="true">
                      {colors.map((color) => (
                        <span key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="theme-choice-copy">
                      <strong>
                        <Palette size={14} aria-hidden="true" />
                        {theme.name}
                      </strong>
                      <small>
                        {theme.author} · {theme.version}
                      </small>
                    </span>
                    {active && (
                      <Check size={14} className="theme-choice-check" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
              {settings.customCssPath && !installedTheme && (
                <button
                  type="button"
                  className="theme-choice-card is-active"
                  role="radio"
                  aria-checked="true"
                  onClick={() => setThemePickerOpen(false)}
                >
                  <span className="theme-choice-swatch" aria-hidden="true">
                    <span style={{ backgroundColor: '#f8f5ed' }} />
                    <span style={{ backgroundColor: '#d7cec0' }} />
                    <span style={{ backgroundColor: '#4f6f73' }} />
                  </span>
                  <span className="theme-choice-copy">
                    <strong>
                      <Palette size={14} aria-hidden="true" />
                      {en ? 'Local custom CSS' : '本地自定义 CSS'}
                    </strong>
                    <small>{en ? 'Loaded from disk' : '从本机文件加载'}</small>
                  </span>
                  <Check size={14} className="theme-choice-check" aria-hidden="true" />
                </button>
              )}
            </div>
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
          </div>
        )}
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
        <select
          id="settings-theme-select"
          className="settings-theme-select"
          value={themeValue}
          aria-hidden="true"
          tabIndex={-1}
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
            {BUILT_IN_THEMES.map((theme) => (
              <option key={theme.value} value={`builtin:${theme.value}`}>
                {en ? theme.labelEn : theme.labelZh}
              </option>
            ))}
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
      </SettingsCard>

      <SettingsCard title={en ? 'Focus effects' : '焦点动画'}>
        <p className="appearance-group-description">
          {en
            ? 'Choose how a search result is emphasized in the document. Effects are painted above the content and do not change layout.'
            : '选择搜索命中内容的提示方式。动画绘制在正文上方，不改变正文布局。'}
        </p>
        <SettingRow label={en ? 'Search focus animation' : '搜索焦点动画'}>
          <select
            value={searchFocusEffect}
            onChange={(event) =>
              onChange({ searchFocusEffect: normalizeSearchFocusEffect(event.target.value) })
            }
          >
            {Object.entries(SEARCH_FOCUS_EFFECT_PRESETS).map(([value, preset]) => (
              <option key={value} value={value}>
                {en ? preset.label.en : preset.label.zh}
              </option>
            ))}
          </select>
        </SettingRow>
        <p className="settings-hint">
          {en ? searchFocusPreset.description.en : searchFocusPreset.description.zh}
        </p>
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
            ref={themeManagerDialogRef}
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
