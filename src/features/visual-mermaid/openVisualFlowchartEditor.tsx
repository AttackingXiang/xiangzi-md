import { createRoot, type Root } from 'react-dom/client'
import VisualFlowchartEditor from './VisualFlowchartEditor'
import { parseFlowchart, type FlowPosition } from './flowchartModel'

export interface OpenVisualFlowchartEditorOptions {
  source: string
  renderedPositions?: Record<string, FlowPosition>
  onSave: (source: string) => Promise<void> | void
}

let activeRoot: Root | null = null
let activeHost: HTMLElement | null = null

function closeActiveEditor(): void {
  const root = activeRoot
  const host = activeHost
  activeRoot = null
  activeHost = null
  queueMicrotask(() => {
    root?.unmount()
    host?.remove()
  })
}

export function openVisualFlowchartEditor(options: OpenVisualFlowchartEditorOptions): void {
  closeActiveEditor()
  const result = parseFlowchart(options.source)
  if (!result.ok) throw new Error(result.reason)
  result.model.positions = {
    ...options.renderedPositions,
    ...result.model.positions,
  }

  const host = document.createElement('div')
  host.className = 'xmd-visual-flow-host'
  document.body.append(host)
  const root = createRoot(host)
  activeHost = host
  activeRoot = root
  root.render(
    <VisualFlowchartEditor
      model={result.model}
      onCancel={closeActiveEditor}
      onSave={async (source) => {
        await options.onSave(source)
        closeActiveEditor()
      }}
    />,
  )
}
