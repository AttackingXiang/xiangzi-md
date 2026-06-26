import { X } from 'lucide-react'
import type { AppSettings } from '../types'
import { t, getLang } from '../lib/i18n'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onShowShortcuts: () => void
  onClose: () => void
}

/** 设置面板：外观、附件存储方式、图片尺寸 */
export default function Settings({
  settings,
  onChange,
  onShowShortcuts,
  onClose
}: Props): JSX.Element {
  const en = getLang() === 'en'
  const attachHint = en
    ? `Pasted or dropped images are saved to ${
        settings.attachmentMode === 'subfolder'
          ? `the "${settings.attachmentFolder || 'assets'}" folder next to the document`
          : 'the same folder as the document'
      }, and inserted with a relative path.`
    : `粘贴或拖入图片时，会自动保存到${
        settings.attachmentMode === 'subfolder'
          ? `文档同级的「${settings.attachmentFolder || 'assets'}」文件夹`
          : '与文档相同的目录'
      }，并以相对路径写入 Markdown。`

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('设置')}</span>
          <button className="icon-btn sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-group">
            <h3>{t('外观')}</h3>

            <label className="settings-row">
              <span className="settings-label">{t('界面语言')}</span>
              <select
                value={settings.language}
                onChange={(e) => onChange({ language: e.target.value as AppSettings['language'] })}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>

            <label className="settings-row">
              <span className="settings-label">{t('主题')}</span>
              <select
                value={settings.theme}
                onChange={(e) => onChange({ theme: e.target.value as AppSettings['theme'] })}
              >
                <option value="system">{t('跟随系统')}</option>
                <option value="light">{t('浅色')}</option>
                <option value="dark">{t('深色')}</option>
              </select>
            </label>
            <label className="settings-row">
              <span className="settings-label">{t('编辑区宽度')}</span>
              <select
                value={settings.editorWidth}
                onChange={(e) =>
                  onChange({ editorWidth: e.target.value as AppSettings['editorWidth'] })
                }
              >
                <option value="normal">{t('适中')}</option>
                <option value="wide">{t('较宽')}</option>
                <option value="full">{t('全宽')}</option>
              </select>
            </label>

            <label className="settings-row">
              <span className="settings-label">{t('标题自动编号')}</span>
              <input
                type="checkbox"
                checked={settings.headingNumber}
                onChange={(e) => onChange({ headingNumber: e.target.checked })}
              />
            </label>

            <label className="settings-row">
              <span className="settings-label">{t('自动保存')}</span>
              <input
                type="checkbox"
                checked={settings.autoSave}
                onChange={(e) => onChange({ autoSave: e.target.checked })}
              />
            </label>
            <p className="settings-hint">
              {t('开启后，已保存过的文档在停止输入约 1 秒后自动写回磁盘。')}
            </p>

            <label className="settings-row">
              <span className="settings-label">{t('自定义主题 CSS')}</span>
              <span className="settings-inline">
                {settings.customCssPath && (
                  <button className="secondary-btn" onClick={() => onChange({ customCssPath: '' })}>
                    {t('清除')}
                  </button>
                )}
                <button
                  className="secondary-btn"
                  onClick={async () => {
                    const res = await window.api.pickCss()
                    if (res) onChange({ customCssPath: res.path })
                  }}
                >
                  {settings.customCssPath ? t('更换…') : t('选择…')}
                </button>
              </span>
            </label>
            {settings.customCssPath && (
              <p className="settings-hint settings-path">{settings.customCssPath}</p>
            )}
          </section>

          <section className="settings-group">
            <h3>{t('图片与附件')}</h3>

            <label className="settings-row">
              <span className="settings-label">{t('附件存放方式')}</span>
              <select
                value={settings.attachmentMode}
                onChange={(e) =>
                  onChange({ attachmentMode: e.target.value as AppSettings['attachmentMode'] })
                }
              >
                <option value="subfolder">{t('文档同级的子文件夹')}</option>
                <option value="same">{t('与文档相同目录')}</option>
              </select>
            </label>

            {settings.attachmentMode === 'subfolder' && (
              <label className="settings-row">
                <span className="settings-label">{t('子文件夹名称')}</span>
                <input
                  type="text"
                  value={settings.attachmentFolder}
                  placeholder="assets"
                  onChange={(e) => onChange({ attachmentFolder: e.target.value || 'assets' })}
                />
              </label>
            )}

            <p className="settings-hint">{attachHint}</p>

            <label className="settings-row">
              <span className="settings-label">{t('图片最大显示宽度')}</span>
              <span className="settings-inline">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={settings.imageMaxWidth}
                  onChange={(e) => onChange({ imageMaxWidth: Number(e.target.value) || 0 })}
                />
                <span className="settings-unit">{t('px（0 = 不限制）')}</span>
              </span>
            </label>
            <p className="settings-hint">{t('修改后对新打开的文档生效。')}</p>
          </section>

          <section className="settings-group">
            <h3>{t('键盘')}</h3>
            <label className="settings-row">
              <span className="settings-label">{t('快捷键')}</span>
              <button className="secondary-btn" onClick={onShowShortcuts}>
                {t('查看全部快捷键')}
              </button>
            </label>
          </section>
        </div>
      </div>
    </div>
  )
}
