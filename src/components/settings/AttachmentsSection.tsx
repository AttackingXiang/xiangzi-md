import type { AppSettings } from '../../types'
import { t } from '../../lib/i18n'
import { SettingsPage, SettingsCard, SettingRow, ToggleRow } from './primitives'
import type { SectionProps } from './types'

export default function AttachmentsSection({ settings, onChange, en }: SectionProps): JSX.Element {
  const folder = settings.attachmentFolder || 'assets'
  const usesFolder = ['subfolder', 'docSubfolder', 'vaultSubfolder'].includes(
    settings.attachmentMode,
  )
  const sample: Record<AppSettings['attachmentMode'], string> = {
    same: 'image.png',
    subfolder: `${folder}/image.png`,
    docSubfolder: `${folder}/${en ? 'doc-name' : '文档名'}/image.png`,
    vault: `…/image.png`,
    vaultSubfolder: `…/${folder}/image.png`,
  }
  return (
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
              onChange={(event) => onChange({ attachmentFolder: event.target.value || 'assets' })}
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
              onChange={(event) => onChange({ imageMaxWidth: Number(event.target.value) || 0 })}
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
  )
}
