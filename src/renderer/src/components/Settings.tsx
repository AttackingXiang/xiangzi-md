import { X } from 'lucide-react'
import type { AppSettings } from '../types'

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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>设置</span>
          <button className="icon-btn sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-group">
            <h3>外观</h3>
            <label className="settings-row">
              <span className="settings-label">主题</span>
              <select
                value={settings.theme}
                onChange={(e) => onChange({ theme: e.target.value as AppSettings['theme'] })}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="settings-row">
              <span className="settings-label">自动保存</span>
              <input
                type="checkbox"
                checked={settings.autoSave}
                onChange={(e) => onChange({ autoSave: e.target.checked })}
              />
            </label>
            <p className="settings-hint">开启后，已保存过的文档在停止输入约 1 秒后自动写回磁盘。</p>
          </section>

          <section className="settings-group">
            <h3>图片与附件</h3>

            <label className="settings-row">
              <span className="settings-label">附件存放方式</span>
              <select
                value={settings.attachmentMode}
                onChange={(e) =>
                  onChange({ attachmentMode: e.target.value as AppSettings['attachmentMode'] })
                }
              >
                <option value="subfolder">文档同级的子文件夹</option>
                <option value="same">与文档相同目录</option>
              </select>
            </label>

            {settings.attachmentMode === 'subfolder' && (
              <label className="settings-row">
                <span className="settings-label">子文件夹名称</span>
                <input
                  type="text"
                  value={settings.attachmentFolder}
                  placeholder="assets"
                  onChange={(e) => onChange({ attachmentFolder: e.target.value || 'assets' })}
                />
              </label>
            )}

            <p className="settings-hint">
              粘贴或拖入图片时，会自动保存到
              {settings.attachmentMode === 'subfolder'
                ? `文档同级的「${settings.attachmentFolder || 'assets'}」文件夹`
                : '与文档相同的目录'}
              ，并以相对路径写入 Markdown。
            </p>

            <label className="settings-row">
              <span className="settings-label">图片最大显示宽度</span>
              <span className="settings-inline">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={settings.imageMaxWidth}
                  onChange={(e) => onChange({ imageMaxWidth: Number(e.target.value) || 0 })}
                />
                <span className="settings-unit">px（0 = 不限制）</span>
              </span>
            </label>
            <p className="settings-hint">修改后对新打开的文档生效。</p>
          </section>

          <section className="settings-group">
            <h3>键盘</h3>
            <label className="settings-row">
              <span className="settings-label">快捷键</span>
              <button className="secondary-btn" onClick={onShowShortcuts}>
                查看全部快捷键
              </button>
            </label>
          </section>
        </div>
      </div>
    </div>
  )
}
