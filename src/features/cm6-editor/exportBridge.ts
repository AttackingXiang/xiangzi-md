import type { Extension } from '@codemirror/state'

export interface MarkdownEditorExportSnapshot {
  value: string
  width: number
  className: string
  extensions: readonly Extension[]
}

type ExportSnapshotProvider = () => MarkdownEditorExportSnapshot | null

let activeProvider: ExportSnapshotProvider | null = null

export const markdownEditorExportBridge = {
  register(provider: ExportSnapshotProvider): () => void {
    activeProvider = provider
    return () => {
      if (activeProvider === provider) activeProvider = null
    }
  },

  snapshot(): MarkdownEditorExportSnapshot | null {
    return activeProvider?.() ?? null
  },
}
