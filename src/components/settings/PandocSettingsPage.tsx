import { useEffect, useState } from 'react'
import { desktop } from '../../platform'
import type { AppSettings } from '../../types'
import { SettingsPage, SettingsCard, SettingRow, ToggleRow } from './primitives'

interface PandocStatus {
  path: string
  version: string
}

export default function PandocSettingsPage({
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
          label={en ? 'Number Word headings' : 'Word 标题编号'}
          description={
            en
              ? 'Generate section numbers when exporting a Word document.'
              : '导出 Word 文档时为章节标题生成编号。'
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
