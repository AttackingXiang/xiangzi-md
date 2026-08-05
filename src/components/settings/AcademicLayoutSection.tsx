import { useMemo, useState } from 'react'
import {
  ACADEMIC_PREVIEW_SAMPLE,
  academicPreviewCssVars,
  renderAcademicPreviewHtml,
} from '../../lib/academicPreview'
import { desktop } from '../../platform'
import type { AcademicLayout, AppSettings } from '../../types'
import { SettingRow } from './primitives'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
  /** 当前打开的 Markdown 文档；不是 Markdown 或没有打开文件时为 null，
   * 预览退回内置样张。 */
  activeDocument: { name: string; markdown: string } | null
}

/** 字号输入统一走半磅步进——Word 自己的字号输入框也只允许调到 0.5pt，
 * 这里跟着这个约束走，而不是让用户能填出 OOXML 表示不了的字号。 */
const FONT_STEP = 0.5

function numberField(
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): JSX.Element {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={FONT_STEP}
      value={value}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(next)
      }}
    />
  )
}

export default function AcademicLayoutSection({
  settings,
  onChange,
  en,
  activeDocument,
}: Props): JSX.Element {
  const layout = settings.academicLayout
  const [previewPending, setPreviewPending] = useState(false)

  const update = (patch: Partial<AcademicLayout>): void => {
    onChange({ academicLayout: { ...layout, ...patch } })
  }
  const setHeadingSize = (index: number, value: number): void => {
    const next = [...layout.headingFontPt] as AcademicLayout['headingFontPt']
    next[index] = value
    update({ headingFontPt: next })
  }
  // H3–H6 在大多数论文里就没有必要分别设置，统一编辑省去四个几乎总是相同的
  // 输入框；真要做出层级差异，仍然可以逐个改设置文件，这里只是常用路径。
  const setDeepHeadingSize = (value: number): void => {
    const next = [...layout.headingFontPt] as AcademicLayout['headingFontPt']
    for (let index = 2; index < next.length; index += 1) next[index] = value
    update({ headingFontPt: next })
  }

  const previewMarkdown = activeDocument?.markdown ?? ACADEMIC_PREVIEW_SAMPLE
  const previewHtml = useMemo(() => renderAcademicPreviewHtml(previewMarkdown), [previewMarkdown])
  const previewVars = useMemo(() => academicPreviewCssVars(layout), [layout])

  const openInWord = async (): Promise<void> => {
    setPreviewPending(true)
    try {
      await desktop.previewAcademicDocx(previewMarkdown, layout)
    } catch (error) {
      await desktop.notify(
        (en ? 'Could not generate the preview document:\n' : '生成预览文档失败：\n') +
          (error as Error).message,
      )
    } finally {
      setPreviewPending(false)
    }
  }

  return (
    <>
      <p className="settings-hint">
        {en
          ? 'These values only apply to real Word exports when "Use standard format" above is on. The preview below always reflects them, so you can dial in a look before turning the switch on.'
          : '这些参数只在上方「使用标准格式」开启时应用到真实导出；下方预览始终反映它们，方便你在开启前先把效果调好。'}
      </p>

      <SettingRow label={en ? 'Body font size' : '正文字号'}>
        <span className="settings-inline">
          {numberField(layout.bodyFontPt, 6, 36, (bodyFontPt) => update({ bodyFontPt }))}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Body line spacing' : '正文行距'}>
        <span className="settings-inline">
          <input
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={layout.bodyLineHeight}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) update({ bodyLineHeight: next })
            }}
          />
          <span className="settings-unit">{en ? '× line' : '倍'}</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'First-line indent' : '首行缩进'}>
        <span className="settings-inline">
          <input
            type="number"
            min={0}
            max={8}
            step={0.5}
            value={layout.firstLineIndentChars}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) update({ firstLineIndentChars: next })
            }}
          />
          <span className="settings-unit">{en ? 'characters' : '字符'}</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Page margins' : '页边距'}>
        <span className="settings-inline">
          <input
            type="number"
            min={5}
            max={60}
            step={1}
            value={layout.marginMm}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) update({ marginMm: next })
            }}
          />
          <span className="settings-unit">mm</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Paper size' : '纸张'}>
        <select
          value={layout.paper}
          onChange={(event) => update({ paper: event.target.value as AcademicLayout['paper'] })}
        >
          <option value="a4">A4</option>
          <option value="letter">{en ? 'Letter' : 'Letter（美式信纸）'}</option>
        </select>
      </SettingRow>

      <SettingRow label={en ? 'Title font size' : '题名字号'}>
        <span className="settings-inline">
          {numberField(layout.titleFontPt, 6, 72, (titleFontPt) => update({ titleFontPt }))}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Heading 1 size' : '一级标题字号'}>
        <span className="settings-inline">
          {numberField(layout.headingFontPt[0], 6, 48, (value) => setHeadingSize(0, value))}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Heading 2 size' : '二级标题字号'}>
        <span className="settings-inline">
          {numberField(layout.headingFontPt[1], 6, 48, (value) => setHeadingSize(1, value))}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Heading 3+ size' : '三级及以下标题字号'}>
        <span className="settings-inline">
          {numberField(layout.headingFontPt[2], 6, 48, setDeepHeadingSize)}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Caption size' : '图表题注字号'}>
        <span className="settings-inline">
          {numberField(layout.captionFontPt, 6, 24, (captionFontPt) => update({ captionFontPt }))}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>
      <SettingRow label={en ? 'Bibliography size' : '参考文献字号'}>
        <span className="settings-inline">
          {numberField(layout.bibliographyFontPt, 6, 24, (bibliographyFontPt) =>
            update({ bibliographyFontPt }),
          )}
          <span className="settings-unit">pt</span>
        </span>
      </SettingRow>

      <div className="academic-preview-header">
        <span className="settings-hint">
          {activeDocument
            ? en
              ? `Previewing "${activeDocument.name}"`
              : `预览「${activeDocument.name}」`
            : en
              ? 'No Markdown document is open — showing a sample.'
              : '当前没有打开 Markdown 文档，显示的是内置样张。'}
        </span>
        <button
          type="button"
          className="secondary-btn"
          disabled={previewPending}
          onClick={() => void openInWord()}
        >
          {previewPending
            ? en
              ? 'Generating…'
              : '生成中…'
            : en
              ? 'Preview in Word…'
              : '在 Word 中预览…'}
        </button>
      </div>
      <div className="academic-preview">
        <div
          className={`academic-preview-page${layout.threeLineTable ? ' ap-three-line' : ''}${layout.codeBlockBordered ? ' ap-code-bordered' : ''}`}
          style={previewVars}
          // 内容来自 renderAcademicPreviewHtml：复用剪贴板序列化器的转义与安全
          // href 过滤，跟 TableZoomModal 的表格预览走的是同一条已被信任的路径。
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        {layout.pageNumberFooter && (
          <p className="academic-preview-footer">
            {en
              ? '— page number appears here (not paginated in this preview) —'
              : '— 页码会出现在这里（本预览不分页）—'}
          </p>
        )}
      </div>
    </>
  )
}
