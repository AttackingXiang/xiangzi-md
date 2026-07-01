import type { Node as ProseNode, NodeType, Schema } from '@milkdown/kit/prose/model'
import { Selection, type Command } from '@milkdown/kit/prose/state'
import { toggleMark, setBlockType, wrapIn } from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
} from '@milkdown/kit/prose/tables'
import { editorBridge } from './editorBridge'

/** 用当前活跃编辑器执行一个由 schema 构造的命令 */
function exec(make: (schema: Schema) => Command | false | null | undefined): void {
  const view = editorBridge.get()
  if (!view) return
  const cmd = make(view.state.schema)
  if (!cmd) return
  editorBridge.markUserEdit()
  cmd(view.state, view.dispatch)
  view.focus()
}

function execCommand(command: Command): void {
  const view = editorBridge.get()
  if (!view) return
  editorBridge.markUserEdit()
  command(view.state, view.dispatch)
  view.focus()
}

function taskList(): void {
  const view = editorBridge.get()
  const bulletList = view?.state.schema.nodes.bullet_list
  const listItem = view?.state.schema.nodes.list_item
  if (!view || !bulletList || !listItem) return

  editorBridge.markUserEdit()
  wrapInList(bulletList)(view.state, view.dispatch)

  const latest = editorBridge.get()
  if (!latest) return
  const { $from, from, to } = latest.state.selection
  const positions = new Set<number>()
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === listItem) positions.add($from.before(depth))
  }
  latest.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === listItem) positions.add(pos)
  })

  let tr = latest.state.tr
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)
    if (node?.type === listItem && node.attrs.checked == null) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false })
    }
  }
  if (tr.docChanged) latest.dispatch(tr)
  latest.focus()
}

function insertTable(rows = 3, columns = 3): void {
  const view = editorBridge.get()
  if (!view) return
  const { schema } = view.state
  const table = schema.nodes.table
  const headerRow = schema.nodes.table_header_row
  const row = schema.nodes.table_row
  const header = schema.nodes.table_header
  const cell = schema.nodes.table_cell
  if (!table || !headerRow || !row || !header || !cell) return

  const createCells = (type: NodeType): ProseNode[] =>
    Array.from({ length: columns }, () => {
      const result = type.createAndFill()
      if (!result) throw new Error(`Cannot create ${type.name}`)
      return result
    })
  const tableRows = [
    headerRow.create(null, createCells(header)),
    ...Array.from({ length: Math.max(1, rows - 1) }, () => row.create(null, createCells(cell))),
  ]
  const tableNode = table.create(null, tableRows)
  const insertAt = view.state.selection.from
  const tr = view.state.tr.replaceSelectionWith(tableNode)
  const nextSelection = Selection.findFrom(tr.doc.resolve(insertAt), 1, true)
  if (nextSelection) tr.setSelection(nextSelection)
  editorBridge.markUserEdit()
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

/** 是否有可用的所见即所得编辑器（源码模式下没有） */
export function hasWysiwyg(): boolean {
  return !!editorBridge.get()
}

export const editorCmd = {
  bold: () => exec((s) => s.marks.strong && toggleMark(s.marks.strong)),
  italic: () => exec((s) => s.marks.emphasis && toggleMark(s.marks.emphasis)),
  inlineCode: () => exec((s) => s.marks.inlineCode && toggleMark(s.marks.inlineCode)),
  heading: (level: number) =>
    exec((s) => s.nodes.heading && setBlockType(s.nodes.heading, { level })),
  paragraph: () => exec((s) => s.nodes.paragraph && setBlockType(s.nodes.paragraph)),
  codeBlock: () => exec((s) => s.nodes.code_block && setBlockType(s.nodes.code_block)),
  bulletList: () => exec((s) => s.nodes.bullet_list && wrapInList(s.nodes.bullet_list)),
  orderedList: () => exec((s) => s.nodes.ordered_list && wrapInList(s.nodes.ordered_list)),
  taskList,
  insertTable,
  quote: () => exec((s) => s.nodes.blockquote && wrapIn(s.nodes.blockquote)),
  addRowBefore: () => execCommand(addRowBefore),
  addRowAfter: () => execCommand(addRowAfter),
  addColumnBefore: () => execCommand(addColumnBefore),
  addColumnAfter: () => execCommand(addColumnAfter),
  deleteRow: () => execCommand(deleteRow),
  deleteColumn: () => execCommand(deleteColumn),
  deleteTable: () => execCommand(deleteTable),
}

/** 剪贴板操作（依赖编辑器内当前选区，菜单项以 mousedown preventDefault 保留选区） */
export const clipboardCmd = {
  copy: () => document.execCommand('copy'),
  cut: () => document.execCommand('cut'),
  paste: () => document.execCommand('paste'),
  selectAll: () => {
    const request = new Event('xmd-select-all', { cancelable: true })
    if (!window.dispatchEvent(request)) return
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement?.getAttribute('contenteditable') === 'true'
    ) {
      document.execCommand('selectAll')
    }
  },
}
