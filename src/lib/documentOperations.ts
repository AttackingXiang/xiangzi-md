export type OpenPathResult =
  | { kind: 'opened' | 'activated'; path: string; tabId: string }
  | { kind: 'failed'; path: string; reason: 'unsupported' | 'unavailable' }

export type SaveOperationResult =
  | { kind: 'saved'; path: string; tabId: string }
  | { kind: 'cancelled' | 'conflict' | 'failed'; tabId: string }
  | { kind: 'duplicate'; path: string; tabId: string; existingTabId: string }

export function saveOperationSucceeded(result: SaveOperationResult): boolean {
  return result.kind === 'saved'
}
