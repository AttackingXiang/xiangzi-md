import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  AlignJustify,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  ClipboardPaste,
  Code,
  Columns,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Pilcrow,
  Quote,
  Scissors,
  SquareCode,
  Table2,
  TableColumnsSplit,
  TableRowsSplit,
  TextSelect,
  Trash2,
  Wand2,
} from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { clipboardCmd, editorCmd, hasWysiwyg } from '../lib/editorCommands'
import { t } from '../lib/i18n'
import { copyImageElement } from '../lib/richClipboard'
import { tablePickerBridge } from '../lib/tablePickerBridge'

type ContextMenuState = {
  x: number
  y: number
  items: MenuItem[]
  preserveSelection?: boolean
} | null

export function useEditorContextMenu(
  setCtxMenu: Dispatch<SetStateAction<ContextMenuState>>,
): (x: number, y: number, image?: HTMLImageElement, inTable?: boolean) => void {
  const openEditorContext = useCallback(
    (x: number, y: number, image?: HTMLImageElement, inTable = false) => {
      const sz = 15
      const items: MenuItem[] = [
        ...(image
          ? [
              {
                label: t('复制图片'),
                icon: <Copy size={sz} />,
                onClick: () => void copyImageElement(image),
              },
            ]
          : []),
        { label: t('剪切'), icon: <Scissors size={sz} />, hint: '⌘X', onClick: clipboardCmd.cut },
        { label: t('复制'), icon: <Copy size={sz} />, hint: '⌘C', onClick: clipboardCmd.copy },
        {
          label: t('粘贴'),
          icon: <ClipboardPaste size={sz} />,
          hint: '⌘V',
          onClick: clipboardCmd.paste,
        },
      ]
      if (hasWysiwyg()) {
        if (inTable) {
          items.push(
            {
              label: t('在上方插入行'),
              icon: <ArrowUpToLine size={sz} />,
              onClick: editorCmd.addRowBefore,
              separatorBefore: true,
            },
            {
              label: t('在下方插入行'),
              icon: <ArrowDownToLine size={sz} />,
              onClick: editorCmd.addRowAfter,
            },
            {
              label: t('在左侧插入列'),
              icon: <ArrowLeftToLine size={sz} />,
              onClick: editorCmd.addColumnBefore,
            },
            {
              label: t('在右侧插入列'),
              icon: <ArrowRightToLine size={sz} />,
              onClick: editorCmd.addColumnAfter,
            },
            {
              label: t('自动分配列宽'),
              icon: <AlignJustify size={sz} />,
              onClick: editorCmd.distributeAutoFit,
              separatorBefore: true,
            },
            {
              label: t('自动调整列宽'),
              icon: <Wand2 size={sz} />,
              onClick: editorCmd.smartColumnWidth,
            },
            {
              label: t('不设置列宽'),
              icon: <Columns size={sz} />,
              onClick: editorCmd.clearColumnWidths,
            },
            {
              label: t('放大展开'),
              icon: <Maximize2 size={sz} />,
              onClick: editorCmd.expandTable,
            },
            {
              label: t('删除当前行'),
              icon: <TableRowsSplit size={sz} />,
              onClick: editorCmd.deleteRow,
              separatorBefore: true,
              danger: true,
            },
            {
              label: t('删除当前列'),
              icon: <TableColumnsSplit size={sz} />,
              onClick: editorCmd.deleteColumn,
              danger: true,
            },
            {
              label: t('删除表格'),
              icon: <Trash2 size={sz} />,
              onClick: editorCmd.deleteTable,
              danger: true,
            },
          )
        } else {
          items.push(
            {
              label: t('加粗'),
              icon: <Bold size={sz} />,
              hint: '⌘B',
              onClick: editorCmd.bold,
              separatorBefore: true,
              compactGroup: 'inline-format',
            },
            {
              label: t('斜体'),
              icon: <Italic size={sz} />,
              hint: '⌘I',
              onClick: editorCmd.italic,
              compactGroup: 'inline-format',
            },
            {
              label: t('行内代码'),
              icon: <Code size={sz} />,
              hint: '⌘E',
              onClick: editorCmd.inlineCode,
              compactGroup: 'inline-format',
            },
            {
              label: t('标题 1'),
              icon: <Heading1 size={sz} />,
              onClick: () => editorCmd.heading(1),
              separatorBefore: true,
              compactGroup: 'block-style',
            },
            {
              label: t('标题 2'),
              icon: <Heading2 size={sz} />,
              onClick: () => editorCmd.heading(2),
              compactGroup: 'block-style',
            },
            {
              label: t('标题 3'),
              icon: <Heading3 size={sz} />,
              onClick: () => editorCmd.heading(3),
              compactGroup: 'block-style',
            },
            {
              label: t('正文'),
              icon: <Pilcrow size={sz} />,
              onClick: editorCmd.paragraph,
              compactGroup: 'block-style',
            },
            {
              label: t('无序列表'),
              icon: <List size={sz} />,
              onClick: editorCmd.bulletList,
              separatorBefore: true,
              compactGroup: 'block-format',
            },
            {
              label: t('有序列表'),
              icon: <ListOrdered size={sz} />,
              onClick: editorCmd.orderedList,
              compactGroup: 'block-format',
            },
            {
              label: t('任务列表'),
              icon: <ListTodo size={sz} />,
              onClick: editorCmd.taskList,
              compactGroup: 'block-format',
            },
            {
              label: t('引用'),
              icon: <Quote size={sz} />,
              onClick: editorCmd.quote,
              compactGroup: 'block-format',
            },
            {
              label: t('代码块'),
              icon: <SquareCode size={sz} />,
              onClick: editorCmd.codeBlock,
              separatorBefore: true,
            },
            {
              label: t('插入表格'),
              icon: <Table2 size={sz} />,
              onClick: () => tablePickerBridge.request(x, y, editorCmd.insertTable),
              separatorBefore: true,
            },
          )
        }
      }
      items.push({
        label: t('全选'),
        icon: <TextSelect size={sz} />,
        hint: '⌘A',
        onClick: clipboardCmd.selectAll,
        separatorBefore: true,
      })
      setCtxMenu({ x, y, items, preserveSelection: true })
    },
    [setCtxMenu],
  )

  return openEditorContext
}
