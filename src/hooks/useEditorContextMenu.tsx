import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  Bold,
  ClipboardPaste,
  Code,
  Columns3,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Rows3,
  Scissors,
  SquareCode,
  Table2,
  TextSelect,
} from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { clipboardCmd, editorCmd, hasWysiwyg } from '../lib/editorCommands'
import { t } from '../lib/i18n'
import { copyImageElement } from '../lib/richClipboard'

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
            compactGroup: 'block-format',
          },
        )
        if (!inTable) {
          items.push({
            label: t('插入表格'),
            icon: <Table2 size={sz} />,
            onClick: editorCmd.insertTable,
            separatorBefore: true,
          })
        }
        if (inTable) {
          items.push(
            {
              label: t('在上方插入行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.addRowBefore,
              separatorBefore: true,
              compactGroup: 'table-insert',
            },
            {
              label: t('在下方插入行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.addRowAfter,
              compactGroup: 'table-insert',
            },
            {
              label: t('在左侧插入列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.addColumnBefore,
              compactGroup: 'table-insert',
            },
            {
              label: t('在右侧插入列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.addColumnAfter,
              compactGroup: 'table-insert',
            },
            {
              label: t('删除当前行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.deleteRow,
              separatorBefore: true,
              compactGroup: 'table-delete',
            },
            {
              label: t('删除当前列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.deleteColumn,
              compactGroup: 'table-delete',
            },
            {
              label: t('删除表格'),
              icon: <Table2 size={sz} />,
              onClick: editorCmd.deleteTable,
              danger: true,
              compactGroup: 'table-delete',
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
