import { X } from 'lucide-react'
import { desktop } from '../platform'
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
  onClose,
}: Props): JSX.Element {
  const en = getLang() === 'en'
  const folder = settings.attachmentFolder || 'assets'
  const usesFolder =
    settings.attachmentMode === 'subfolder' ||
    settings.attachmentMode === 'docSubfolder' ||
    settings.attachmentMode === 'vaultSubfolder'

  // 示例路径（相对文档目录），帮助理解
  const sample: Record<AppSettings['attachmentMode'], string> = {
    same: 'image.png',
    subfolder: `${folder}/image.png`,
    docSubfolder: `${folder}/${en ? 'doc-name' : '文档名'}/image.png`,
    vault: `…/image.png`,
    vaultSubfolder: `…/${folder}/image.png`,
  }
  const attachHint = en
    ? `Pasted or dropped images are saved automatically; the path written to Markdown looks like: ${sample[settings.attachmentMode]}`
    : `粘贴或拖入图片时自动保存，写入 Markdown 的路径形如：${sample[settings.attachmentMode]}`

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
                    const res = await desktop.pickCss()
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
                <option value="subfolder">{t('文档同级子文件夹')}</option>
                <option value="docSubfolder">{t('文档同级·按文档名分文件夹')}</option>
                <option value="same">{t('与文档相同目录')}</option>
                <option value="vault">{t('仓库根目录')}</option>
                <option value="vaultSubfolder">{t('仓库根的子文件夹')}</option>
              </select>
            </label>

            {usesFolder && (
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

            <label className="settings-row">
              <span className="settings-label">{t('文件树中隐藏附件文件夹')}</span>
              <input
                type="checkbox"
                checked={settings.hideAttachmentFolders ?? false}
                onChange={(e) => onChange({ hideAttachmentFolders: e.target.checked })}
              />
            </label>
            <p className="settings-hint">
              {t('勾选后，文件树不显示与「子文件夹名称」同名的目录（不影响文件实际存储）。')}
            </p>

            <label className="settings-row settings-row-top">
              <span className="settings-label">{t('额外图片搜索目录')}</span>
              <textarea
                className="settings-textarea"
                rows={3}
                value={(settings.assetSearchPaths ?? []).join('\n')}
                placeholder={
                  en ? '/path/to/static\n/path/to/public' : '/path/to/static\n/path/to/public'
                }
                onChange={(e) =>
                  onChange({
                    assetSearchPaths: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <p className="settings-hint">
              {t(
                '图片无法在文档目录找到时，依次搜索这里列出的目录（每行一个绝对路径）。适用于图片统一存放在与文档不同层级的情况。',
              )}
            </p>
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
