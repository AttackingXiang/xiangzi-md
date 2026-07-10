import type { TableColumnWidthMode } from './editorCommands'

export interface TableLayoutOverride {
  index: number
  signature: string
  mode: TableColumnWidthMode | 'manual'
  widths?: number[]
}

const PREFIX = 'xmd:table-layout:v1:'

function keyFor(documentKey: string): string {
  let hash = 2166136261
  for (const char of documentKey) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${PREFIX}${(hash >>> 0).toString(36)}`
}

export function tableSignature(table: HTMLTableElement): string {
  const text = Array.from(table.rows)
    .slice(0, 2)
    .flatMap((row) => Array.from(row.cells).map((cell) => cell.textContent?.trim() ?? ''))
    .join('\u001f')
  return `${table.rows.length}:${table.rows[0]?.cells.length ?? 0}:${text.slice(0, 300)}`
}

export function loadTableLayouts(documentKey: string): TableLayoutOverride[] {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(documentKey)) ?? '[]') as unknown
    return Array.isArray(value) ? (value as TableLayoutOverride[]) : []
  } catch {
    return []
  }
}

export function saveTableLayout(documentKey: string, override: TableLayoutOverride): void {
  const records = loadTableLayouts(documentKey)
  const existing = records.findIndex(
    (record) => record.index === override.index || record.signature === override.signature,
  )
  if (existing >= 0) records[existing] = override
  else records.push(override)
  localStorage.setItem(keyFor(documentKey), JSON.stringify(records.slice(-100)))
}
