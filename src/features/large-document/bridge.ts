export interface LargeDocumentHandler {
  reorderHeading: (fromIndex: number, toIndex: number) => void
  selectAll: () => void
  copy: () => boolean
  cut: () => boolean
  undo: () => boolean
  redo: () => boolean
}

let handler: LargeDocumentHandler | null = null

export const largeDocumentBridge = {
  set(next: LargeDocumentHandler | null): void {
    handler = next
  },
  get(): LargeDocumentHandler | null {
    return handler
  },
}
