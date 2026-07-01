import type { Ctx } from '@milkdown/kit/ctx'
import { TableNodeView } from '@milkdown/kit/component/table-block'
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { columnResizing, updateColumnsOnResize } from '@milkdown/kit/prose/tables'
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'

const MIN_COLUMN_WIDTH = 48
const DEFAULT_COLUMN_WIDTH = 100

/**
 * Crepe 的表格 NodeView 保留了行列增删、排序和对齐工具，但缺少 colgroup，
 * 因而 ProseMirror 官方列宽插件无法生效。这里补上它需要的列轨道。
 */
class ResizableTableNodeView extends TableNodeView {
  private readonly table: HTMLTableElement
  private readonly colgroup: HTMLTableColElement

  constructor(ctx: Ctx, node: Node, view: EditorView, getPos: () => number | undefined) {
    super(ctx, node, view, getPos)
    const table = this.dom.querySelector<HTMLTableElement>('table.children')
    if (!table) throw new Error('Crepe table DOM was not created')

    const colgroup = document.createElement('colgroup')
    table.insertBefore(colgroup, this.contentDOM)
    table.style.setProperty('--default-cell-min-width', `${DEFAULT_COLUMN_WIDTH}px`)
    this.table = table
    this.colgroup = colgroup
    this.updateColumnTracks(node)
  }

  private updateColumnTracks(node: Node): void {
    updateColumnsOnResize(node, this.colgroup, this.table, DEFAULT_COLUMN_WIDTH)
  }

  override update(node: Node): boolean {
    if (node.type !== this.node.type) return false
    if (node.sameMarkup(this.node) && node.content.eq(this.node.content)) return true
    const accepted = super.update(node)
    if (accepted) this.updateColumnTracks(node)
    return accepted
  }

  override stopEvent(event: Event): boolean {
    // 活跃列宽手柄优先于 Crepe 的单元格选择逻辑。
    if (event.type === 'mousedown' && this.view.dom.classList.contains('resize-cursor')) {
      return false
    }
    return super.stopEvent(event)
  }
}

export const resizableTableView = $view(
  tableSchema.node,
  (ctx): NodeViewConstructor =>
    (node, view, getPos) =>
      new ResizableTableNodeView(ctx, node, view, getPos),
)

export const tableColumnResizingPlugin = $prose(() =>
  columnResizing({
    View: null,
    handleWidth: 8,
    cellMinWidth: MIN_COLUMN_WIDTH,
    defaultCellMinWidth: DEFAULT_COLUMN_WIDTH,
    lastColumnResizable: true,
  }),
)
