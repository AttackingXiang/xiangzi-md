import { createRequestBridge } from './bridgeFactory'

type InsertFn = (rows: number, cols: number) => void

export const tablePickerBridge =
  createRequestBridge<[x: number, y: number, onInsert: InsertFn]>('tablePickerBridge')
