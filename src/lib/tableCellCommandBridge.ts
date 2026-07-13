export type TableCellInlineFormat = 'bold' | 'italic' | 'strike' | 'inlineCode'

export interface TableCellCommandState {
  focused: boolean
  hasSelection: boolean
  bold: boolean
  italic: boolean
  strike: boolean
  inlineCode: boolean
}

export const DEFAULT_TABLE_CELL_COMMAND_STATE: TableCellCommandState = {
  focused: false,
  hasSelection: false,
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
}

interface ActiveTableCell {
  element: HTMLElement
  runInline: (format: TableCellInlineFormat) => boolean
  selectAll: () => void
  readState: () => Omit<TableCellCommandState, 'focused'>
}

type Listener = (state: TableCellCommandState) => void
let active: ActiveTableCell | null = null
let state = DEFAULT_TABLE_CELL_COMMAND_STATE
const listeners = new Set<Listener>()

function publish(next: TableCellCommandState): void {
  state = next
  for (const listener of listeners) listener(next)
}

function stateForActive(): TableCellCommandState {
  return active ? { focused: true, ...active.readState() } : DEFAULT_TABLE_CELL_COMMAND_STATE
}

export const tableCellCommandBridge = {
  activate(owner: ActiveTableCell): void {
    active = owner
    publish(stateForActive())
  },

  deactivate(element: HTMLElement): void {
    if (active?.element !== element) return
    active = null
    publish(DEFAULT_TABLE_CELL_COMMAND_STATE)
  },

  refresh(element?: HTMLElement): void {
    if (!active || (element && active.element !== element)) return
    publish(stateForActive())
  },

  isFocused(): boolean {
    return active !== null
  },

  ownsTarget(target: EventTarget | null): boolean {
    if (!active || !(target instanceof Node)) return false
    return target === active.element || active.element.contains(target)
  },

  runInline(format: TableCellInlineFormat): boolean {
    if (!active) return false
    const handled = active.runInline(format)
    publish(stateForActive())
    return handled
  },

  selectAll(): boolean {
    if (!active) return false
    active.selectAll()
    publish(stateForActive())
    return true
  },

  getState(): TableCellCommandState {
    return state
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(state)
    return () => listeners.delete(listener)
  },

  reset(): void {
    active = null
    publish(DEFAULT_TABLE_CELL_COMMAND_STATE)
  },
}
