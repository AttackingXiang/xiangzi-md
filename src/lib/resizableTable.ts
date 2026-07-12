import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx } from '@milkdown/kit/core'
import { TableNodeView } from '@milkdown/kit/component/table-block'
import { moveColCommand, moveRowCommand, tableSchema } from '@milkdown/kit/preset/gfm'
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
  private cleanupReorder: (() => void) | null = null
  private dimmedCells: HTMLElement[] = []
  private dropLine: HTMLElement | null = null

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
    this.initHandleReorder()
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
    this.cleanupReorder?.()
    super.destroy()
  }

  private getRows(): HTMLTableRowElement[] {
    return Array.from(this.table.querySelectorAll<HTMLTableRowElement>('tr'))
  }

  private headerCells(): HTMLTableCellElement[] {
    const first = this.getRows()[0]
    return first ? Array.from(first.querySelectorAll<HTMLTableCellElement>('th, td')) : []
  }

  /** 指针位置命中的行/列索引（以中线为界，落在后半段则算下一格）。 */
  private indexFromPointer(type: 'row' | 'col', clientX: number, clientY: number): number {
    if (type === 'row') {
      const rows = this.getRows()
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (clientY < r.top + r.height / 2) return i
      }
      return rows.length - 1
    }
    const cells = this.headerCells()
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i].getBoundingClientRect()
      if (clientX < c.left + c.width / 2) return i
    }
    return cells.length - 1
  }

  private clearDragCue(): void {
    for (const el of this.dimmedCells) el.style.opacity = ''
    this.dimmedCells = []
    this.dropLine?.remove()
    this.dropLine = null
  }

  private dimTrack(type: 'row' | 'col', index: number): void {
    const rows = this.getRows()
    const cells =
      type === 'row'
        ? Array.from(rows[index]?.querySelectorAll<HTMLTableCellElement>('th, td') ?? [])
        : rows.map((r) => r.querySelectorAll<HTMLTableCellElement>('th, td')[index]).filter(Boolean)
    for (const cell of cells) {
      if (!cell) continue
      cell.style.opacity = '0.45'
      this.dimmedCells.push(cell)
    }
  }

  /** 在落点边界画一条插入指示线。 */
  private showDropLine(type: 'row' | 'col', targetIndex: number, dragIndex: number): void {
    if (!this.dropLine) {
      const line = document.createElement('div')
      line.className = 'xmd-table-drop-line'
      this.dom.appendChild(line)
      this.dropLine = line
    }
    const line = this.dropLine
    const base = this.table.getBoundingClientRect()
    const domRect = this.dom.getBoundingClientRect()
    // 落点在目标格「靠拖动来向的一侧」边界
    const after = targetIndex >= dragIndex
    if (type === 'row') {
      const rect = this.getRows()[targetIndex]?.getBoundingClientRect()
      if (!rect) return
      const y = (after ? rect.bottom : rect.top) - domRect.top
      Object.assign(line.style, {
        left: `${base.left - domRect.left}px`,
        top: `${y}px`,
        width: `${base.width}px`,
        height: '2px',
      })
    } else {
      const rect = this.headerCells()[targetIndex]?.getBoundingClientRect()
      if (!rect) return
      const x = (after ? rect.right : rect.left) - domRect.left
      Object.assign(line.style, {
        left: `${x}px`,
        top: `${base.top - domRect.top}px`,
        width: '2px',
        height: `${base.height}px`,
      })
    }
  }

  /**
   * 用指针事件（pointerdown/move/up）实现行/列拖动重排。
   *
   * Crepe 原生依赖 HTML5 drag-and-drop（dragstart/drop），但在 Tauri 的
   * WKWebView 里、contenteditable 内的原生拖放极不可靠，drop 常常根本不触发，
   * 所以内置重排「拖了没反应」。这里改用指针事件自行计算落点并调用 gfm 的
   * moveRow/moveColCommand，绕开原生拖放；同时拦掉 handle 上的原生 dragstart，
   * 避免两套机制打架、以及残留的拖动预览。
   */
  private initHandleReorder(): void {
    let type: 'row' | 'col' | null = null
    let dragIndex = -1
    let pointerId = -1
    let moved = false
    let startX = 0
    let startY = 0

    const finish = (commit: PointerEvent | null): void => {
      const t = type
      const from = dragIndex
      const wasMoved = moved
      type = null
      dragIndex = -1
      pointerId = -1
      moved = false
      this.clearDragCue()
      if (!t || !wasMoved || !commit) return
      let to = this.indexFromPointer(t, commit.clientX, commit.clientY)
      // 表头行必须留在首行：正文行不能落到表头之上。
      if (t === 'row' && to === 0) to = 1
      if (to < 0 || to === from) return
      const pos = (this.getPos() ?? 0) + 1
      const key = t === 'col' ? moveColCommand.key : moveRowCommand.key
      this.ctx.get(commandsCtx).call(key, { from, to, pos })
      requestAnimationFrame(() => this.view.focus())
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !this.view.editable) return
      const target = e.target
      if (!(target instanceof Element) || target.closest('button')) return
      const handle = target.closest('[data-role]')
      const role = handle instanceof HTMLElement ? handle.dataset.role : undefined
      if (role !== 'row-drag-handle' && role !== 'col-drag-handle') return

      type = role === 'row-drag-handle' ? 'row' : 'col'
      const rect = handle!.getBoundingClientRect()
      dragIndex = this.indexFromPointer(
        type,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      // 表头行固定在首行，不参与拖动重排。
      if (type === 'row' && dragIndex === 0) {
        type = null
        return
      }
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      moved = false
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (type === null || e.pointerId !== pointerId) return
      if (!moved) {
        if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) return
        moved = true
        try {
          this.dom.setPointerCapture(pointerId)
        } catch {
          /* setPointerCapture 偶发失败可忽略，仍用 window 监听兜底 */
        }
        this.dimTrack(type, dragIndex)
      }
      e.preventDefault()
      const target = this.indexFromPointer(type, e.clientX, e.clientY)
      this.showDropLine(type, target, dragIndex)
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (type === null || e.pointerId !== pointerId) return
      finish(e)
    }

    const onPointerCancel = (e: PointerEvent): void => {
      if (type === null || e.pointerId !== pointerId) return
      finish(null)
    }

    // 拦掉 handle 上的原生拖放：捕获阶段 preventDefault + stopPropagation，
    // 既终止不可靠的原生 drag，也阻止 Crepe 的 dragstart 处理器建立预览。
    const onDragStartCapture = (e: DragEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      const handle = target.closest('[data-role]')
      const role = handle instanceof HTMLElement ? handle.dataset.role : undefined
      if (role === 'row-drag-handle' || role === 'col-drag-handle') {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    this.dom.addEventListener('pointerdown', onPointerDown, { capture: true })
    this.dom.addEventListener('dragstart', onDragStartCapture, { capture: true })
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    this.cleanupReorder = () => {
      this.dom.removeEventListener('pointerdown', onPointerDown, { capture: true })
      this.dom.removeEventListener('dragstart', onDragStartCapture, { capture: true })
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      this.clearDragCue()
    }
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
