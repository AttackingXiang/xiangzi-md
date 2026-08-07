import { useEffect, useState } from 'react'
import { desktop } from '../../platform'
import type { AppSettings } from '../../types'
import AcademicLayoutSection from './AcademicLayoutSection'
import { SettingsPage, SettingsCard, SettingRow, ToggleRow } from './primitives'

interface PandocStatus {
  path: string
  version: string
}

export default function PandocSettingsPage({
  settings,
  onChange,
  en,
  activeDocument,
}: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
  activeDocument: { name: string; markdown: string } | null
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

  // 选中一份新的自定义模板时，四个「导出行为」开关默认全部关掉：模板通常已经
  // 带着完整的样式/目录/页码，直接叠加我们的处理反而会覆盖用户在模板里做的
  // 选择。这只是一次性的默认值——开关本身不会被禁用，用户随时可以按需重新
  // 打开某一项，把"自定义模板 + 这个开关"的组合找回来。
  const applyCustomTemplate = (path: string): void => {
    onChange({
      pandocReferenceDoc: path,
      pandocToc: false,
      pandocNumberSections: false,
      pandocNormalizeFonts: false,
      pandocAcademicLayout: false,
    })
  }

  const chooseTemplate = async (): Promise<void> => {
    const result = await desktop.pickWordTemplate()
    if (result) applyCustomTemplate(result.path)
  }

  const exportDefaultTemplate = async (): Promise<void> => {
    try {
      const result = await desktop.savePandocDefaultTemplate()
      if (result) applyCustomTemplate(result.path)
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

      {pandocStatus === null ? (
        <SettingsCard title={en ? 'Word template & export settings' : 'Word 模板与导出设置'}>
          <p className="settings-hint">
            {en
              ? 'Templates, export behavior, standard format, import, and advanced arguments all run through Pandoc. Install it (see above) to configure them.'
              : '模板、导出行为、标准格式、导入以及高级参数都要靠 Pandoc 执行；先在上方安装 Pandoc，这些设置才会出现。'}
          </p>
        </SettingsCard>
      ) : (
        <>
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
                  {settings.pandocReferenceDoc
                    ? en
                      ? 'Replace…'
                      : '更换…'
                    : en
                      ? 'Choose…'
                      : '选择…'}
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
            <ToggleRow
              label={en ? 'Use standard format' : '使用标准格式'}
              description={
                en
                  ? 'A4 pages with 2.5cm margins, 1.5 line spacing, first-line indent, and title/heading sizes below. Applies together with a custom template, if one is selected above — it patches the named styles pandoc always uses (Body Text, Heading 1–6, Title, …), not the template itself.'
                  : 'A4 页面、2.5cm 页边距、1.5 倍行距、首行缩进两字，以及下方的题名/标题字号等参数。即使上方选了自定义模板也会一起生效——它改的是 pandoc 固定使用的命名样式（正文、一至六级标题、题名……），不是模板本身。'
              }
              checked={settings.pandocAcademicLayout}
              onChange={(pandocAcademicLayout) => onChange({ pandocAcademicLayout })}
            />
            <ToggleRow
              label={en ? 'Three-line tables' : '三线表'}
              description={
                en
                  ? 'Top/bottom rule and a rule under the header row only, no vertical or body rules. Only takes effect while "Use standard format" above is on.'
                  : '仅表格顶/底与表头下沿三条横线，无竖线、无表体横线；仅在上方「使用标准格式」开启时才实际生效。'
              }
              checked={settings.academicLayout.threeLineTable}
              onChange={(threeLineTable) =>
                onChange({ academicLayout: { ...settings.academicLayout, threeLineTable } })
              }
            />
            <ToggleRow
              label={en ? 'Centered page numbers' : '居中页码'}
              description={
                en
                  ? 'Add a centered page number to the footer. Only takes effect while "Use standard format" above is on.'
                  : '在页脚居中显示页码；仅在上方「使用标准格式」开启时才实际生效。'
              }
              checked={settings.academicLayout.pageNumberFooter}
              onChange={(pageNumberFooter) =>
                onChange({ academicLayout: { ...settings.academicLayout, pageNumberFooter } })
              }
            />
            <ToggleRow
              label={en ? 'Code block border' : '代码块加框'}
              description={
                en
                  ? 'Draw a box border around code blocks. Only takes effect while "Use standard format" above is on.'
                  : '给代码块加上边框。仅在上方「使用标准格式」开启时才实际生效。'
              }
              checked={settings.academicLayout.codeBlockBordered}
              onChange={(codeBlockBordered) =>
                onChange({ academicLayout: { ...settings.academicLayout, codeBlockBordered } })
              }
            />
          </SettingsCard>

          {settings.pandocAcademicLayout && (
            <SettingsCard title={en ? 'Standard format parameters' : '标准格式参数'}>
              <AcademicLayoutSection
                settings={settings}
                onChange={onChange}
                en={en}
                activeDocument={activeDocument}
              />
            </SettingsCard>
          )}

          <SettingsCard title={en ? 'Import behavior' : '导入行为'}>
            <SettingRow label={en ? 'Media folder' : '图片目录'}>
              <input
                type="text"
                value={settings.pandocMediaFolder}
                placeholder="assets"
                onChange={(event) =>
                  onChange({ pandocMediaFolder: event.target.value || 'assets' })
                }
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
        </>
      )}
    </SettingsPage>
  )
}
