import { Info } from 'lucide-react'
import type { AppSettings } from '../../types'
import { t } from '../../lib/i18n'
import { SettingsPage, SettingsCard, SettingRow, ToggleRow } from './primitives'
import type { SectionProps } from './types'

export default function EditorSection({ settings, onChange, en }: SectionProps): JSX.Element {
  return (
    <SettingsPage
      title={en ? 'Editor' : '编辑器'}
      description={
        en ? 'Writing behavior and document presentation.' : '调整写作行为与文档呈现方式。'
      }
    >
      <SettingsCard>
        <ToggleRow
          label={t('标题自动编号')}
          description={en ? 'Show hierarchical numbers before headings.' : '在标题前显示层级编号。'}
          checked={settings.headingNumber}
          onChange={(checked) => onChange({ headingNumber: checked })}
        />
        <ToggleRow
          label={t('自动保存')}
          description={t('开启后，已保存过的文档在停止输入约 1 秒后自动写回磁盘。')}
          checked={settings.autoSave}
          onChange={(checked) => onChange({ autoSave: checked })}
        />
        <ToggleRow
          label={en ? 'Show toolbar' : '显示顶部工具栏'}
          description={
            en
              ? 'Show a formatting toolbar above the editor in editing mode.'
              : '在编辑模式下，编辑器顶部显示格式化工具栏。'
          }
          checked={settings.showToolbar ?? false}
          onChange={(checked) => onChange({ showToolbar: checked })}
        />
        <ToggleRow
          label={en ? 'Wrap code blocks' : '代码块自动换行'}
          description={
            en
              ? 'Wrap long lines inside fenced code blocks. Off by default; horizontal scrolling is used instead.'
              : '代码块中的长行自动换行；默认关闭，关闭时使用横向滚动查看长行。'
          }
          checked={settings.codeBlockLineWrapping ?? false}
          onChange={(codeBlockLineWrapping) => onChange({ codeBlockLineWrapping })}
        />
      </SettingsCard>
      <SettingsCard title={en ? 'Tables' : '表格'}>
        <div className="table-layout-setting">
          <label className="table-layout-setting-row">
            <span className="setting-label-with-info">
              {en ? 'Table column layout' : '表格列宽布局'}
              <span
                className="setting-info-icon"
                title={
                  en
                    ? 'This is the default layout for tables without an individual override.'
                    : '这是未单独指定布局的表格所使用的默认渲染方式。'
                }
              >
                <Info size={14} />
              </span>
            </span>
            <select
              value={settings.tableAutoWidth ?? 'distribute'}
              onChange={(event) =>
                onChange({
                  tableAutoWidth: event.target.value as AppSettings['tableAutoWidth'],
                })
              }
            >
              <option value="distribute">
                {en ? 'Smart fill (recommended)' : '智能占满（推荐）'}
              </option>
              <option value="fit">{en ? 'Fit to content' : '按内容适配'}</option>
              <option value="equal">{en ? 'Equal width' : '等宽分配'}</option>
            </select>
          </label>
          <p className="table-layout-description">
            {(settings.tableAutoWidth ?? 'distribute') === 'fit'
              ? en
                ? 'Fits each column to its content; wide tables may scroll horizontally.'
                : '按单元格内容的自然宽度显示，较宽的表格可能出现横向滚动。'
              : (settings.tableAutoWidth ?? 'distribute') === 'equal'
                ? en
                  ? 'Gives every column the same width and fills the editor.'
                  : '所有列使用相同宽度，并铺满编辑区域。'
                : en
                  ? 'Distributes width by content needs and fills the editor.'
                  : '根据各列内容需求智能分配宽度，并铺满编辑区域。'}
          </p>
        </div>
        <ToggleRow
          label={en ? 'Automatically resize while editing' : '编辑时自动调整表格'}
          description={
            en
              ? 'After input pauses in a table cell, reapply that table’s current layout. Individual and manually resized tables keep their overrides.'
              : '在表格单元格内停止输入后，按照该表格当前的渲染方式重新调整；单表规则和手动列宽优先保留。'
          }
          checked={settings.tableAutoResize ?? true}
          onChange={(tableAutoResize) => onChange({ tableAutoResize })}
        />
      </SettingsCard>
      <SettingsCard title={en ? 'Editor overlays' : '编辑器浮层'}>
        <ToggleRow
          label={en ? 'Selection toolbar' : '选中文本快捷工具栏'}
          description={
            en
              ? 'Show formatting actions when regular document text is selected.'
              : '选中普通正文时显示格式快捷操作；代码块内始终不显示。'
          }
          checked={settings.showSelectionToolbar}
          onChange={(showSelectionToolbar) => onChange({ showSelectionToolbar })}
        />
      </SettingsCard>
      <SettingsCard title={en ? 'Copy control' : '复制控制'}>
        <SettingRow label={en ? 'Copy images as' : '图片复制为'}>
          <select
            value={settings.imageCopyMode ?? 'image'}
            onChange={(event) =>
              onChange({
                imageCopyMode: event.target.value as AppSettings['imageCopyMode'],
              })
            }
          >
            <option value="image">{en ? 'Image' : '图片'}</option>
            <option value="address">{en ? 'Address' : '地址'}</option>
          </select>
        </SettingRow>
        <SettingRow label={en ? 'Copy Mermaid as' : 'Mermaid 复制为'}>
          <select
            value={settings.mermaidCopyMode ?? 'image'}
            onChange={(event) =>
              onChange({
                mermaidCopyMode: event.target.value as AppSettings['mermaidCopyMode'],
              })
            }
          >
            <option value="image">{en ? 'Image' : '图片'}</option>
            <option value="source">{en ? 'Source text' : '源文本'}</option>
          </select>
        </SettingRow>
        <p className="settings-hint">
          {en
            ? 'Applies when the selection contains an image or Mermaid diagram. Defaults to copying the image.'
            : '当选中内容包含图片或 Mermaid 图表时生效，默认复制图片。'}
        </p>
      </SettingsCard>
      <SettingsCard title={en ? 'Tags' : '标签'}>
        <ToggleRow
          label={en ? 'Show all tags when clicking document tags' : '点击文档标签时展示全部标签'}
          description={
            en
              ? 'When clicking a tag inside a document, show the all-tags tree on the left. Off by default — the file tree is hidden and only the results column opens.'
              : '点文档内部的标签时，在左侧展示「全部标签」树。默认关闭——文件树会隐藏，只打开中间结果列。'
          }
          checked={settings.tagClickOpensOverview ?? false}
          onChange={(checked) => onChange({ tagClickOpensOverview: checked })}
        />
      </SettingsCard>
    </SettingsPage>
  )
}
