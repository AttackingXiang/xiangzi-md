import { desktop } from '../../platform'
import type { AppSettings } from '../../types'
import { t } from '../../lib/i18n'
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
  return (
    <SettingsPage
      title={en ? 'Appearance' : '外观'}
      description={en ? 'Keep the workspace calm and readable.' : '保持工作区清爽、稳定且易读。'}
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
            onChange={(event) => onChange({ theme: event.target.value as AppSettings['theme'] })}
          >
            <option value="system">{t('跟随系统')}</option>
            <option value="light">{t('浅色')}</option>
            <option value="dark">{t('深色')}</option>
            <option value="warm">{t('暖色')}</option>
            <option value="mint">{t('浅绿')}</option>
            <option value="blue">{t('蓝调')}</option>
            <option value="summer">{t('夏日')}</option>
            <option value="sakura">{t('樱粉')}</option>
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
      <SettingsCard title={t('背景图片')}>
        <div className="settings-file-picker">
          <div>
            <p>{settings.backgroundImagePath || (en ? 'No background image' : '未设置背景图片')}</p>
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
      </SettingsCard>
      <SettingsCard title={t('自定义主题 CSS')}>
        <div className="settings-file-picker">
          <div>
            <p>{settings.customCssPath || (en ? 'Use the built-in theme' : '使用内置主题')}</p>
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
      </SettingsCard>
    </SettingsPage>
  )
}
