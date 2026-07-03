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
import type { EditorView } from '@milkdown/kit/prose/view'
import { editorBridge } from './editorBridge'
import { tableZoomBridge } from './tableZoomBridge'

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

const MIN_AUTO_COLUMN = 64
const MAX_AUTO_COLUMN = 640

/** 取当前选区所在表格的真实 <table> DOM（排除拖拽预览用的空表） */
function activeTableEl(view: EditorView, tablePos: number): HTMLTableElement | null {
  const nodeEl = view.nodeDOM(tablePos)
  if (!(nodeEl instanceof Element)) return null
  return nodeEl.querySelector<HTMLTableElement>('table.children') ?? nodeEl.querySelector('table')
}

/**
 * 对当前选区所在表格的每个单元格重写 colwidth。
 * compute 返回该单元格（按其起始列与 colspan）应有的列宽数组；返回 null 表示清除宽度。
 */
function rewriteColumnWidths(
  compute: (colStart: number, colspan: number) => number[] | null,
): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const map = TableMap.get(table.node)
  const seen = new Set<number>()
  const tr = view.state.tr
  for (const rawPos of map.map) {
    if (seen.has(rawPos)) continue
    seen.add(rawPos)
    const docPos = table.start + rawPos
    const node = view.state.doc.nodeAt(docPos)
    if (!node) continue
    const colStart = map.colCount(rawPos)
    const colspan = node.attrs.colspan as number
    tr.setNodeMarkup(tr.mapping.map(docPos), null, {
      ...node.attrs,
      colwidth: compute(colStart, colspan),
    })
  }
  editorBridge.markUserEdit()
  view.dispatch(tr)
  view.focus()
}

/** 表格可用的横向空间（容器可视宽度，不含滚动条），用于「占满宽度」的分配。 */
function tableAvailableWidth(tableEl: HTMLTableElement, numCols: number): number {
  const wrapper = tableEl.closest<HTMLElement>('.table-wrapper')
  const width = wrapper ? wrapper.clientWidth : Math.floor(tableEl.getBoundingClientRect().width)
  return width > 0 ? width : numCols * 120
}

/**
 * 自动分配列宽：按各列内容占比分配宽度，但总宽恰好占满编辑器宽度，
 * 因此不会出现横向滚动条。内容多的列分得更宽，内容少的列更窄。
 */
function distributeAutoFit(): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const numCols = TableMap.get(table.node).width
  const tableEl = activeTableEl(view, table.pos)
  if (!tableEl) return

  const available = tableAvailableWidth(tableEl, numCols)
  const natural = measureNaturalColumnWidths(tableEl, numCols)
  const totalNatural = natural.reduce((sum, w) => sum + w, 0)

  const minCol = Math.min(MIN_AUTO_COLUMN, Math.floor(available / numCols))
  const widths =
    totalNatural > 0
      ? natural.map((w) => Math.max(Math.floor((w / totalNatural) * available), minCol))
      : Array<number>(numCols).fill(Math.floor(available / numCols))

  // 修正取整误差，让总宽精确等于可用宽度（占满、且不溢出产生滚动条）。
  const diff = available - widths.reduce((sum, w) => sum + w, 0)
  if (widths.length > 0) {
    const widestIdx = widths.reduce((best, w, i) => (w > widths[best] ? i : best), 0)
    widths[widestIdx] = Math.max(minCol, widths[widestIdx] + diff)
  }

  rewriteColumnWidths((colStart, colspan) =>
    Array.from({ length: colspan }, (_, i) => widths[colStart + i] ?? minCol),
  )
}

/**
 * 自动调整列宽：按每列的自然内容宽度设列宽，内容多的列更宽。
 * 各列取内容不换行时的宽度（限制在 [MIN, MAX]），总宽可超出容器，
 * 此时表格底部出现横向滚动条。
 */
function smartColumnWidth(): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const numCols = TableMap.get(table.node).width
  const tableEl = activeTableEl(view, table.pos)
  if (!tableEl) return

  const natural = measureNaturalColumnWidths(tableEl, numCols)
  const widths = natural.map((w) =>
    Math.min(Math.max(w || MIN_AUTO_COLUMN, MIN_AUTO_COLUMN), MAX_AUTO_COLUMN),
  )
  rewriteColumnWidths((colStart, colspan) =>
    Array.from({ length: colspan }, (_, i) => widths[colStart + i] ?? MIN_AUTO_COLUMN),
  )
}

/** 不设置列宽：清除全部列宽，表格回到自适应布局，过宽时可左右滚动。 */
function clearColumnWidths(): void {
  rewriteColumnWidths(() => null)
}

/**
 * 临时解除列宽约束，测量每一列在内容不换行时的自然宽度（含内边距）。
 * 使用 table-layout:auto + width:max-content，让浏览器按内容自动排布，
 * 再逐列读取渲染宽度，最后恢复原有内联样式。
 */
function measureNaturalColumnWidths(table: HTMLTableElement, numCols: number): number[] {
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>('col'))
  const savedColWidths = cols.map((c) => c.style.width)
  const saved = {
    tableLayout: table.style.tableLayout,
    width: table.style.width,
    minWidth: table.style.minWidth,
  }
  cols.forEach((c) => {
    c.style.width = ''
  })
  table.style.tableLayout = 'auto'
  table.style.width = 'max-content'
  table.style.minWidth = '0'

  const widths = Array<number>(numCols).fill(0)
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    let colIdx = 0
    for (const cell of Array.from(row.children)) {
      if (!(cell instanceof HTMLElement)) continue
      const colspan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1
      if (colspan === 1 && colIdx < numCols) {
        widths[colIdx] = Math.max(widths[colIdx], Math.ceil(cell.getBoundingClientRect().width))
      }
      colIdx += colspan
    }
  }

  cols.forEach((c, i) => {
    c.style.width = savedColWidths[i] ?? ''
  })
  table.style.tableLayout = saved.tableLayout
  table.style.width = saved.width
  table.style.minWidth = saved.minWidth
  return widths
}

/**
 * 放大展开：把当前表格克隆为静态 HTML，交给弹窗全屏展示。
 * 保留各列当前的宽度比例（以百分比重建 colgroup），弹窗内按比例占满宽度，
 * 内容照常换行——不会出现「宽列只显示一行」的情况。
 */
function expandTable(): void {
  const view = editorBridge.get()
  if (!view) return
  const table = findTable(view.state.selection.$from)
  if (!table) return
  const tableEl = activeTableEl(view, table.pos)
  if (!tableEl) return
  const numCols = TableMap.get(table.node).width

  // 读取当前每一列的渲染宽度，换算成比例
  const ratios = Array<number>(numCols).fill(0)
  const firstRow = tableEl.querySelector('tr')
  if (firstRow) {
    let colIdx = 0
    for (const cell of Array.from(firstRow.children)) {
      if (!(cell instanceof HTMLElement)) continue
      const colspan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1
      const per = cell.getBoundingClientRect().width / colspan
      for (let i = 0; i < colspan && colIdx < numCols; i++) ratios[colIdx++] = per
    }
    const total = ratios.reduce((sum, w) => sum + w, 0)
    if (total > 0) for (let i = 0; i < numCols; i++) ratios[i] = ratios[i] / total
  }

  const clone = tableEl.cloneNode(true) as HTMLTableElement
  clone.classList.remove('children')
  clone.removeAttribute('style')
  clone.querySelector('colgroup')?.remove()
  clone.querySelectorAll<HTMLElement>('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })
  clone.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    // 仅保留对齐相关的 text-align，其余内联宽度/变换等一律清除
    const align = el.style.textAlign
    el.removeAttribute('style')
    if (align) el.style.textAlign = align
  })

  if (ratios.some((r) => r > 0)) {
    const colgroup = document.createElement('colgroup')
    for (const r of ratios) {
      const col = document.createElement('col')
      col.style.width = `${(r * 100).toFixed(4)}%`
      colgroup.appendChild(col)
    }
    clone.insertBefore(colgroup, clone.firstChild)
  }
  tableZoomBridge.request(clone.outerHTML)
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
  // 空选区时探测的是 [from, from+1)，若光标恰好在文档末尾要夹住，否则 rangeHasMark 越界报错
  const docSize = view.state.doc.content.size
  const checkTo = empty ? Math.min(to + 1, docSize) : to
  // If selection already has a link, remove it
  if (view.state.doc.rangeHasMark(from, checkTo, linkMark)) {
    exec((s) => s.marks.link && toggleMark(s.marks.link))
    return
  }
  const href = window.prompt('URL')
  if (!href?.trim()) return
  const trimmed = href.trim()
  // 无 scheme 前缀的输入按 https 处理；scheme 非 http/https/mailto 一律拒绝插入，
  // 防止 javascript:/data: 等危险协议通过手动插入链接绕过前面的外链拦截
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  let url: string
  if (!schemeMatch) {
    url = `https://${trimmed}`
  } else {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return
    url = trimmed
  }
  const tr = view.state.tr
  if (empty) {
    // 空选区：插入 URL 文本本身并加 link mark，而不是把 mark 盲目套在光标后的下一个字符上
    tr.insertText(url, from)
    tr.addMark(from, from + url.length, linkMark.create({ href: url, title: '' }))
  } else {
    tr.addMark(from, to, linkMark.create({ href: url, title: '' }))
  }
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
  distributeAutoFit,
  smartColumnWidth,
  clearColumnWidths,
  expandTable,
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
