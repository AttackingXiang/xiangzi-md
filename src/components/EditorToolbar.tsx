import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ArrowUp,
  ArrowDown,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Table,
  Link,
  Undo2,
  Redo2,
  Pilcrow,
  Palette,
  Highlighter,
} from 'lucide-react'
import {
  DEFAULT_TOOLBAR_ACTIVE_STATE,
  toolbarStateBridge,
  type ToolbarActiveState,
} from '../lib/toolbarStateBridge'
import { editorCmd } from '../lib/editorCommands'
import { tablePickerBridge } from '../lib/tablePickerBridge'
import {
  DEFAULT_TABLE_CELL_COMMAND_STATE,
  tableCellCommandBridge,
  type TableCellCommandState,
} from '../lib/tableCellCommandBridge'
import TextColorPalette from './TextColorPalette'
import HighlightColorPalette from './HighlightColorPalette'
import { highlighterModeBridge } from '../lib/highlighterModeBridge'
import type { HighlighterModeState } from '../lib/highlighterModeBridge'

interface Props {
  lang: 'zh' | 'en'
  textColors: readonly string[]
  defaultTextColor: string
  highlightColors: readonly string[]
  defaultHighlightColor: string
}

export default function EditorToolbar({
  lang,
  textColors,
  defaultTextColor,
  highlightColors,
  defaultHighlightColor,
}: Props): JSX.Element {
  const [ts, setTs] = useState<ToolbarActiveState>(DEFAULT_TOOLBAR_ACTIVE_STATE)
  const [cellState, setCellState] = useState<TableCellCommandState>(
    DEFAULT_TABLE_CELL_COMMAND_STATE,
  )
  const [showColors, setShowColors] = useState(false)
  const [showHighlightColors, setShowHighlightColors] = useState(false)
  const textColorControlRef = useRef<HTMLDivElement>(null)
  const highlightColorControlRef = useRef<HTMLDivElement>(null)
  const [highlighterMode, setHighlighterMode] = useState<HighlighterModeState>(
    highlighterModeBridge.getState(),
  )

  useEffect(() => {
    toolbarStateBridge.setListener(setTs)
    return () => toolbarStateBridge.setListener(null)
  }, [])

  useEffect(() => tableCellCommandBridge.subscribe(setCellState), [])

  useEffect(() => highlighterModeBridge.subscribe(setHighlighterMode), [])

  useEffect(
    () => highlighterModeBridge.syncDefaultColor(defaultHighlightColor),
    [defaultHighlightColor],
  )

  useEffect(() => {
    if (!showColors && !showHighlightColors) return
    const closeColorPopovers = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        textColorControlRef.current?.contains(target) ||
        highlightColorControlRef.current?.contains(target)
      )
        return
      setShowColors(false)
      setShowHighlightColors(false)
    }
    document.addEventListener('pointerdown', closeColorPopovers, true)
    return () => document.removeEventListener('pointerdown', closeColorPopovers, true)
  }, [showColors, showHighlightColors])

  const t = (zh: string, en: string): string => (lang === 'en' ? en : zh)

  const preserveEditorSelection = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Keep CM6 focused so its selection and active syntax context remain intact.
    event.preventDefault()
  }

  const runToolbarAction = (action: () => void): void => {
    action()
  }

  const btn = (
    label: string,
    icon: ReactNode,
    active: boolean,
    action: () => void,
    disabled = false,
  ): JSX.Element => (
    <button
      type="button"
      key={label}
      className={`toolbar-btn${active ? ' is-active' : ''}`}
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onMouseDown={preserveEditorSelection}
      onClick={() => runToolbarAction(action)}
    >
      {icon}
    </button>
  )

  return (
    <div className="editor-toolbar">
      {btn(t('撤销', 'Undo'), <Undo2 size={15} />, false, () => editorCmd.undo?.(), !ts.canUndo)}
      {btn(t('重做', 'Redo'), <Redo2 size={15} />, false, () => editorCmd.redo?.(), !ts.canRedo)}

      <span className="toolbar-sep" />

      {btn(
        t('正文', 'Paragraph'),
        <Pilcrow size={15} />,
        !cellState.focused &&
          !ts.headingLevel &&
          !ts.blockquote &&
          !ts.codeBlock &&
          !ts.bulletList &&
          !ts.orderedList &&
          !ts.taskList,
        () => editorCmd.paragraph(),
        cellState.focused,
      )}
      {([1, 2, 3, 4, 5, 6] as const).map((level) =>
        btn(
          `H${level}`,
          level === 1 ? (
            <Heading1 size={15} />
          ) : level === 2 ? (
            <Heading2 size={15} />
          ) : level === 3 ? (
            <Heading3 size={15} />
          ) : level === 4 ? (
            <Heading4 size={15} />
          ) : level === 5 ? (
            <Heading5 size={15} />
          ) : (
            <Heading6 size={15} />
          ),
          ts.headingLevel === level,
          () => editorCmd.heading(level),
          cellState.focused,
        ),
      )}
      {btn(
        t('升级标题', 'Promote heading'),
        <ArrowUp size={15} />,
        false,
        () => editorCmd.promoteHeading(),
        cellState.focused || ts.headingLevel === null || ts.headingLevel <= 1,
      )}
      {btn(
        t('降级标题', 'Demote heading'),
        <ArrowDown size={15} />,
        false,
        () => editorCmd.demoteHeading(),
        cellState.focused || ts.headingLevel === null || ts.headingLevel >= 6,
      )}

      <span className="toolbar-sep" />

      {btn(
        t('加粗', 'Bold'),
        <Bold size={15} />,
        cellState.focused ? cellState.bold : ts.bold,
        () => editorCmd.bold(),
        cellState.focused && !cellState.hasSelection,
      )}
      {btn(
        t('斜体', 'Italic'),
        <Italic size={15} />,
        cellState.focused ? cellState.italic : ts.italic,
        () => editorCmd.italic(),
        cellState.focused && !cellState.hasSelection,
      )}
      {btn(
        t('删除线', 'Strikethrough'),
        <Strikethrough size={15} />,
        cellState.focused ? cellState.strike : ts.strike,
        () => editorCmd.strike(),
        cellState.focused && !cellState.hasSelection,
      )}
      {btn(
        t('行内代码', 'Inline code'),
        <Code size={15} />,
        cellState.focused ? cellState.inlineCode : ts.inlineCode,
        () => editorCmd.inlineCode(),
        cellState.focused && !cellState.hasSelection,
      )}
      <div ref={textColorControlRef} className="toolbar-color-control">
        <button
          type="button"
          className={`toolbar-btn${showColors ? ' is-active' : ''}`}
          aria-label={t('文字颜色', 'Text color')}
          data-tooltip={t('文字颜色', 'Text color')}
          aria-expanded={showColors}
          disabled={cellState.focused}
          onMouseDown={preserveEditorSelection}
          onClick={() => {
            setShowHighlightColors(false)
            setShowColors((visible) => !visible)
          }}
        >
          <Palette size={15} />
        </button>
        {showColors && !cellState.focused && (
          <div className="toolbar-color-popover">
            <TextColorPalette
              lang={lang}
              colors={textColors}
              defaultColor={defaultTextColor}
              onSelect={(color) => {
                editorCmd.textColor(color)
                setShowColors(false)
              }}
            />
          </div>
        )}
      </div>
      <div ref={highlightColorControlRef} className="toolbar-color-control">
        <button
          type="button"
          className={`toolbar-btn toolbar-highlighter-btn${highlighterMode.active ? ' is-active' : ''}`}
          style={
            {
              '--xmd-active-highlight-color': highlighterMode.active
                ? highlighterMode.color
                : 'transparent',
            } as React.CSSProperties
          }
          aria-label={t('荧光笔', 'Highlighter')}
          data-tooltip={t('荧光笔', 'Highlighter')}
          aria-expanded={showHighlightColors}
          disabled={cellState.focused}
          onMouseDown={preserveEditorSelection}
          onClick={() => {
            setShowColors(false)
            setShowHighlightColors((visible) => !visible)
          }}
        >
          <Highlighter
            size={15}
            color={highlighterMode.active ? highlighterMode.color : undefined}
          />
        </button>
        {showHighlightColors && !cellState.focused && (
          <div className="toolbar-color-popover">
            <HighlightColorPalette
              lang={lang}
              colors={highlightColors}
              defaultColor={defaultHighlightColor}
              onSelect={(color) => {
                if (color) {
                  editorCmd.textHighlight(color)
                  highlighterModeBridge.selectColor(color)
                } else {
                  editorCmd.textHighlight(null)
                  highlighterModeBridge.deactivate()
                }
                setShowHighlightColors(false)
              }}
            />
          </div>
        )}
      </div>

      <span className="toolbar-sep" />

      {btn(
        t('无序列表', 'Bullet list'),
        <List size={15} />,
        ts.bulletList,
        () => editorCmd.bulletList(),
        cellState.focused,
      )}
      {btn(
        t('有序列表', 'Ordered list'),
        <ListOrdered size={15} />,
        ts.orderedList,
        () => editorCmd.orderedList(),
        cellState.focused,
      )}
      {btn(
        t('任务列表', 'Task list'),
        <ListTodo size={15} />,
        ts.taskList,
        () => editorCmd.taskList(),
        cellState.focused,
      )}
      {btn(
        t('引用', 'Quote'),
        <Quote size={15} />,
        ts.blockquote,
        () => editorCmd.quote(),
        cellState.focused,
      )}
      {btn(
        t('代码块', 'Code block'),
        <Code2 size={15} />,
        ts.codeBlock,
        () => editorCmd.codeBlock(),
        cellState.focused,
      )}

      <span className="toolbar-sep" />

      <button
        type="button"
        className="toolbar-btn"
        aria-label={t('插入表格', 'Insert table')}
        data-tooltip={t('插入表格', 'Insert table')}
        disabled={cellState.focused}
        onMouseDown={preserveEditorSelection}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          tablePickerBridge.request(rect.left, rect.bottom + 8, editorCmd.insertTable)
        }}
      >
        <Table size={15} />
      </button>
      {btn(
        t('插入链接', 'Insert link'),
        <Link size={15} />,
        ts.link,
        () => editorCmd.insertLink?.(),
        cellState.focused,
      )}
    </div>
  )
}
