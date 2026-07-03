import { useEffect, useState, type ReactNode } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
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
} from 'lucide-react'
import { toolbarStateBridge, type ToolbarActiveState } from '../lib/toolbarStateBridge'
import { editorCmd } from '../lib/editorCommands'

const DEFAULT: ToolbarActiveState = {
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  headingLevel: null,
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  canUndo: false,
  canRedo: false,
}

interface Props {
  lang: 'zh' | 'en'
}

export default function EditorToolbar({ lang }: Props): JSX.Element {
  const [ts, setTs] = useState<ToolbarActiveState>(DEFAULT)

  useEffect(() => {
    toolbarStateBridge.setListener(setTs)
    return () => toolbarStateBridge.setListener(null)
  }, [])

  const t = (zh: string, en: string): string => (lang === 'en' ? en : zh)

  const btn = (
    label: string,
    icon: ReactNode,
    active: boolean,
    action: () => void,
    disabled = false,
  ): JSX.Element => (
    <button
      key={label}
      className={`toolbar-btn${active ? ' is-active' : ''}`}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        action()
      }}
    >
      {icon}
    </button>
  )

  return (
    <div className="editor-toolbar">
      {btn(t('撤销', 'Undo'), <Undo2 size={15} />, false, () => editorCmd.undo?.(), !ts.canUndo)}
      {btn(t('重做', 'Redo'), <Redo2 size={15} />, false, () => editorCmd.redo?.(), !ts.canRedo)}

      <span className="toolbar-sep" />

      {btn(t('正文', 'Paragraph'), <Pilcrow size={15} />, !ts.headingLevel && !ts.blockquote && !ts.codeBlock && !ts.bulletList && !ts.orderedList && !ts.taskList, () => editorCmd.paragraph())}
      {btn('H1', <Heading1 size={15} />, ts.headingLevel === 1, () => editorCmd.heading(1))}
      {btn('H2', <Heading2 size={15} />, ts.headingLevel === 2, () => editorCmd.heading(2))}
      {btn('H3', <Heading3 size={15} />, ts.headingLevel === 3, () => editorCmd.heading(3))}

      <span className="toolbar-sep" />

      {btn(t('加粗', 'Bold'), <Bold size={15} />, ts.bold, () => editorCmd.bold())}
      {btn(t('斜体', 'Italic'), <Italic size={15} />, ts.italic, () => editorCmd.italic())}
      {btn(t('删除线', 'Strikethrough'), <Strikethrough size={15} />, ts.strike, () => editorCmd.strike())}
      {btn(t('行内代码', 'Inline code'), <Code size={15} />, ts.inlineCode, () => editorCmd.inlineCode())}

      <span className="toolbar-sep" />

      {btn(t('无序列表', 'Bullet list'), <List size={15} />, ts.bulletList, () => editorCmd.bulletList())}
      {btn(t('有序列表', 'Ordered list'), <ListOrdered size={15} />, ts.orderedList, () => editorCmd.orderedList())}
      {btn(t('任务列表', 'Task list'), <ListTodo size={15} />, ts.taskList, () => editorCmd.taskList())}
      {btn(t('引用', 'Quote'), <Quote size={15} />, ts.blockquote, () => editorCmd.quote())}
      {btn(t('代码块', 'Code block'), <Code2 size={15} />, ts.codeBlock, () => editorCmd.codeBlock())}

      <span className="toolbar-sep" />

      {btn(t('插入表格', 'Insert table'), <Table size={15} />, false, () => editorCmd.insertTable())}
      {btn(t('插入链接', 'Insert link'), <Link size={15} />, ts.link, () => editorCmd.insertLink?.())}
    </div>
  )
}
