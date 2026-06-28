/**
 * 表格列宽拖动（视图级）。
 *
 * Crepe 的表格组件不支持列宽调整，这里在编辑器根节点上做事件委托：
 * 当指针靠近某个单元格的右边缘时显示 col-resize 光标，拖动即调整该列宽度。
 * 因为监听挂在稳定的根节点上，表格重渲染后依然有效。
 *
 * 注意：Markdown 表格语法无法保存列宽，故此调整为临时视图状态。
 */

const EDGE = 6 // 触发区域：距右边缘像素

interface DragState {
  table: HTMLTableElement
  colIndex: number
  startX: number
  startWidth: number
}

function cellAt(el: EventTarget | null): HTMLTableCellElement | null {
  if (!(el instanceof HTMLElement)) return null
  const cell = el.closest('td, th')
  return cell instanceof HTMLTableCellElement ? cell : null
}

/** 指针是否落在单元格右边缘附近 */
function nearRightEdge(cell: HTMLTableCellElement, clientX: number): boolean {
  const rect = cell.getBoundingClientRect()
  return clientX >= rect.right - EDGE && clientX <= rect.right + EDGE
}

/** 把宽度应用到该列所有单元格 */
function applyColumnWidth(table: HTMLTableElement, colIndex: number, width: number): void {
  const w = `${Math.max(48, Math.round(width))}px`
  for (const row of Array.from(table.rows)) {
    const cell = row.cells[colIndex]
    if (cell) cell.style.width = w
  }
}

export function setupTableResize(root: HTMLElement): () => void {
  let drag: DragState | null = null

  const onMove = (e: PointerEvent): void => {
    if (drag) {
      const delta = e.clientX - drag.startX
      applyColumnWidth(drag.table, drag.colIndex, drag.startWidth + delta)
      e.preventDefault()
      return
    }
    // 非拖动状态：靠近右边缘时给出 col-resize 光标提示
    const cell = cellAt(e.target)
    const hot = cell ? nearRightEdge(cell, e.clientX) : false
    root.style.cursor = hot ? 'col-resize' : ''
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const cell = cellAt(e.target)
    if (!cell || !nearRightEdge(cell, e.clientX)) return
    const table = cell.closest('table')
    if (!(table instanceof HTMLTableElement)) return

    table.style.tableLayout = 'fixed'
    drag = {
      table,
      colIndex: cell.cellIndex,
      startX: e.clientX,
      startWidth: cell.getBoundingClientRect().width,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
    e.stopPropagation()
  }

  const onUp = (): void => {
    if (!drag) return
    drag = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    root.style.cursor = ''
  }

  // 捕获阶段拦截 pointerdown，避免与编辑器内的选区/拖拽冲突
  root.addEventListener('pointerdown', onDown, true)
  root.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  window.addEventListener('blur', onUp)

  return () => {
    onUp()
    root.removeEventListener('pointerdown', onDown, true)
    root.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    window.removeEventListener('blur', onUp)
    root.style.cursor = ''
  }
}
