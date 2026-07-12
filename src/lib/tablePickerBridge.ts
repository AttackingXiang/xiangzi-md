type InsertFn = (rows: number, cols: number) => void
type RequestFn = (x: number, y: number, onInsert: InsertFn) => void

let _handler: RequestFn | null = null

export const tablePickerBridge = {
  setHandler: (h: RequestFn | null): void => {
    _handler = h
  },
  request: (x: number, y: number, onInsert: InsertFn): void => {
    _handler?.(x, y, onInsert)
  },
}
