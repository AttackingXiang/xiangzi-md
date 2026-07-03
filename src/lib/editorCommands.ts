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
  findTable,
  TableMap,
} from '@milkdown/kit/prose/tables'
import { undo, redo } from 'prosemirror-history'
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

function distributeEqualColumns(): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const map = TableMap.get(table.node)
  const numCols = map.width
  const nodeEl = view.nodeDOM(table.pos)
  const tableEl = (nodeEl instanceof Element ? nodeEl : null)?.querySelector('table')
  const totalWidth = tableEl ? Math.floor(tableEl.getBoundingClientRect().width) : numCols * 120
  const colWidth = Math.max(Math.floor(totalWidth / numCols), 48)

  const seen = new Set<number>()
  const tr = view.state.tr
  for (const rawPos of map.map) {
    if (seen.has(rawPos)) continue
    seen.add(rawPos)
    const docPos = table.start + rawPos
    const node = view.state.doc.nodeAt(docPos)
    if (!node) continue
    const colwidths = Array<number>(node.attrs.colspan as number).fill(colWidth)
    tr.setNodeMarkup(tr.mapping.map(docPos), null, { ...node.attrs, colwidth: colwidths })
  }
  editorBridge.markUserEdit()
  view.dispatch(tr)
  view.focus()
}

function smartColumnWidth(): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const map = TableMap.get(table.node)
  const numCols = map.width
  const nodeEl = view.nodeDOM(table.pos)
  const tableEl = (nodeEl instanceof Element ? nodeEl : null)?.querySelector('table')

  // Measure natural content widths from DOM (scrollWidth of each column's cells)
  const naturalWidths = Array<number>(numCols).fill(80)
  if (tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'))
    const colMaxes = Array<number>(numCols).fill(0)
    rows.forEach(row => {
      Array.from(row.querySelectorAll<HTMLElement>('th, td')).forEach((cell, ci) => {
        if (ci < numCols) colMaxes[ci] = Math.max(colMaxes[ci], cell.scrollWidth)
      })
    })
    const totalNatural = colMaxes.reduce((a, b) => a + b, 0)
    const totalWidth = Math.floor(tableEl.getBoundingClientRect().width)
    if (totalNatural > 0) {
      for (let i = 0; i < numCols; i++) {
        naturalWidths[i] = Math.max(Math.floor((colMaxes[i] / totalNatural) * totalWidth), 48)
      }
    }
  }

  const seen = new Set<number>()
  const tr = view.state.tr
  for (const rawPos of map.map) {
    if (seen.has(rawPos)) continue
    seen.add(rawPos)
    const docPos = table.start + rawPos
    const node = view.state.doc.nodeAt(docPos)
    if (!node) continue
    const colIdx = map.colCount(rawPos)
    const colwidths = Array.from({ length: node.attrs.colspan as number }, (_, i) => naturalWidths[colIdx + i] ?? 80)
    tr.setNodeMarkup(tr.mapping.map(docPos), null, { ...node.attrs, colwidth: colwidths })
  }
  editorBridge.markUserEdit()
  view.dispatch(tr)
  view.focus()
}

/** 是否有可用的所见即所得编辑器（源码模式下没有） */
export function hasWysiwyg(): boolean {
  return !!editorBridge.get()
}

function insertLink(): void {
  const view = editorBridge.get()
  if (!view) return
  const linkMark = view.state.schema.marks.link
  if (!linkMark) return
  const { from, to, empty } = view.state.selection
  // If selection already has a link, remove it
  if (view.state.doc.rangeHasMark(from, empty ? to + 1 : to, linkMark)) {
    exec((s) => s.marks.link && toggleMark(s.marks.link))
    return
  }
  const href = window.prompt(view.state.schema.marks.link ? 'URL' : 'URL')
  if (!href?.trim()) return
  const url = href.trim()
  const tr = view.state.tr.addMark(from, empty ? from + 1 : to, linkMark.create({ href: url, title: '' }))
  editorBridge.markUserEdit()
  view.dispatch(tr)
  view.focus()
}

export const editorCmd = {
  bold: () => exec((s) => s.marks.strong && toggleMark(s.marks.strong)),
  italic: () => exec((s) => s.marks.emphasis && toggleMark(s.marks.emphasis)),
  strike: () => exec((s) => s.marks.strike && toggleMark(s.marks.strike)),
  inlineCode: () => exec((s) => s.marks.inlineCode && toggleMark(s.marks.inlineCode)),
  heading: (level: number) =>
    exec((s) => s.nodes.heading && setBlockType(s.nodes.heading, { level })),
  paragraph: () => exec((s) => s.nodes.paragraph && setBlockType(s.nodes.paragraph)),
  codeBlock: () => exec((s) => s.nodes.code_block && setBlockType(s.nodes.code_block)),
  bulletList: () => exec((s) => s.nodes.bullet_list && wrapInList(s.nodes.bullet_list)),
  orderedList: () => exec((s) => s.nodes.ordered_list && wrapInList(s.nodes.ordered_list)),
  taskList,
  insertTable,
  insertLink,
  quote: () => exec((s) => s.nodes.blockquote && wrapIn(s.nodes.blockquote)),
  undo: () => execCommand(undo),
  redo: () => execCommand(redo),
  addRowBefore: () => execCommand(addRowBefore),
  addRowAfter: () => execCommand(addRowAfter),
  addColumnBefore: () => execCommand(addColumnBefore),
  addColumnAfter: () => execCommand(addColumnAfter),
  deleteRow: () => execCommand(deleteRow),
  deleteColumn: () => execCommand(deleteColumn),
  deleteTable: () => execCommand(deleteTable),
  distributeEqualColumns,
  smartColumnWidth,
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
