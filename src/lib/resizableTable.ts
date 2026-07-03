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
 * 同时在 Milkdown 原有拖拽基础上叠加行/列位移动效。
 */
class ResizableTableNodeView extends TableNodeView {
  private readonly table: HTMLTableElement
  private readonly colgroup: HTMLTableColElement
  private cleanupDragAnimation: (() => void) | null = null

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
    this.initDragAnimation()
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

  override destroy(): void {
    this.cleanupDragAnimation?.()
    super.destroy()
  }

  private getRows(): HTMLTableRowElement[] {
    return Array.from(this.table.querySelectorAll<HTMLTableRowElement>('tr'))
  }

  private clearRowAnimations(): void {
    for (const row of this.getRows()) {
      row.style.transition = ''
      row.style.transform = ''
      row.style.opacity = ''
      for (const cell of row.querySelectorAll<HTMLTableCellElement>('th, td')) {
        cell.style.transition = ''
        cell.style.transform = ''
        cell.style.opacity = ''
      }
    }
  }

  private initDragAnimation(): void {
    let dragStartIndex = -1
    let dragType: 'row' | 'col' | null = null

    // Use capture phase so we get the event before the handle calls stopPropagation().
    const onDragStart = (e: DragEvent): void => {
      const handle = (e.target as Element).closest('[data-role]') as HTMLElement | null
      const role = handle?.dataset.role
      if (!handle || (role !== 'row-drag-handle' && role !== 'col-drag-handle')) return

      const rows = this.getRows()

      if (role === 'row-drag-handle') {
        dragType = 'row'
        const rect = handle.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        dragStartIndex = rows.findIndex(r => {
          const rr = r.getBoundingClientRect()
          return mid >= rr.top && mid <= rr.bottom
        })
      } else {
        dragType = 'col'
        const firstRow = rows[0]
        if (!firstRow) return
        const cells = Array.from(firstRow.querySelectorAll<HTMLTableCellElement>('th, td'))
        const rect = handle.getBoundingClientRect()
        const mid = rect.left + rect.width / 2
        dragStartIndex = cells.findIndex(c => {
          const cr = c.getBoundingClientRect()
          return mid >= cr.left && mid <= cr.right
        })
      }
    }

    const onDragOver = (e: DragEvent): void => {
      if (dragType === null || dragStartIndex === -1) return
      const rows = this.getRows()

      if (dragType === 'row') {
        const targetIndex = findOverIndex(rows, e.clientY, 'y')
        if (targetIndex === -1) return
        const draggedHeight = rows[dragStartIndex]?.getBoundingClientRect().height ?? 40

        rows.forEach((row, i) => {
          if (i === dragStartIndex) {
            row.style.transition = ''
            row.style.transform = ''
            row.style.opacity = '0.4'
            return
          }
          row.style.opacity = ''
          row.style.transition = 'transform 150ms ease'
          if (dragStartIndex < targetIndex && i > dragStartIndex && i <= targetIndex) {
            row.style.transform = `translateY(${-draggedHeight}px)`
          } else if (dragStartIndex > targetIndex && i >= targetIndex && i < dragStartIndex) {
            row.style.transform = `translateY(${draggedHeight}px)`
          } else {
            row.style.transform = ''
          }
        })
      } else {
        const firstRow = rows[0]
        if (!firstRow) return
        const firstCells = Array.from(firstRow.querySelectorAll<HTMLTableCellElement>('th, td'))
        const targetIndex = findOverIndex(firstCells, e.clientX, 'x')
        if (targetIndex === -1) return
        const draggedWidth = firstCells[dragStartIndex]?.getBoundingClientRect().width ?? 100

        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('th, td'))
          cells.forEach((cell, i) => {
            if (i === dragStartIndex) {
              cell.style.transition = ''
              cell.style.transform = ''
              cell.style.opacity = '0.4'
              return
            }
            cell.style.opacity = ''
            cell.style.transition = 'transform 150ms ease'
            if (dragStartIndex < targetIndex && i > dragStartIndex && i <= targetIndex) {
              cell.style.transform = `translateX(${-draggedWidth}px)`
            } else if (dragStartIndex > targetIndex && i >= targetIndex && i < dragStartIndex) {
              cell.style.transform = `translateX(${draggedWidth}px)`
            } else {
              cell.style.transform = ''
            }
          })
        })
      }
    }

    const clearAnimation = (): void => {
      dragType = null
      dragStartIndex = -1
      this.clearRowAnimations()
    }

    this.dom.addEventListener('dragstart', onDragStart, { capture: true })
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragend', clearAnimation)
    window.addEventListener('drop', clearAnimation)

    this.cleanupDragAnimation = () => {
      this.dom.removeEventListener('dragstart', onDragStart, { capture: true })
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragend', clearAnimation)
      window.removeEventListener('drop', clearAnimation)
    }
  }
}

function findOverIndex(elements: Element[], pointer: number, axis: 'x' | 'y'): number {
  const startProp = axis === 'x' ? 'left' : 'top'
  const endProp = axis === 'x' ? 'right' : 'bottom'
  const last = elements.length - 1
  return elements.findIndex((el, i) => {
    const r = el.getBoundingClientRect()
    if (r[startProp] <= pointer && pointer <= r[endProp]) return true
    if (i === 0 && pointer < r[startProp]) return true
    if (i === last && pointer > r[endProp]) return true
    return false
  })
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
