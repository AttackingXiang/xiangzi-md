import ReactDOM from 'react-dom/client'
import { MarkdownEditor } from './features/cm6-editor/MarkdownEditor'
import { cm6ActiveViewBridge } from './features/cm6-editor/activeViewBridge'
import './styles/index.css'

const logEl = document.getElementById('perf-log')!
function log(msg: string): void {
  logEl.textContent += msg + '\n'
  console.log('[perf]', msg)
}

async function main(): Promise<void> {
  const readingMode = new URLSearchParams(window.location.search).has('readonly')
  performance.mark('fetch-start')
  const res = await fetch('/perf-test-1mb.md')
  const content = await res.text()
  performance.mark('fetch-end')
  performance.measure('fetch', 'fetch-start', 'fetch-end')
  log(`fetched ${(content.length / 1024).toFixed(0)} KB (${content.length} chars)`)

  performance.mark('mount-start')
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <MarkdownEditor
      content={content}
      allowRemoteImages={false}
      imageMaxWidth={800}
      readingMode={readingMode}
      livePreview={true}
      ariaLabel="1 MiB CM6 performance editor"
      onChange={() => {}}
      onReady={() => performance.mark('editor-ready')}
    />,
  )
  performance.mark('render-called')

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  performance.mark('first-2-rafs')
  performance.measure('mount-call-to-2rafs', 'mount-start', 'first-2-rafs')

  // MarkdownEditor briefly restores the persisted scroll position while async
  // preview heights settle. Wait through that phase before timing a jump.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  performance.mark('layout-stable')

  const view = cm6ActiveViewBridge.get()
  if (!view) throw new Error('CM6 editor did not register its active view')
  if (!readingMode) {
    const middle = Math.floor(view.state.doc.length / 2)
    performance.mark('edit-start')
    view.dispatch({ changes: { from: middle, insert: 'x' } })
    performance.mark('edit-finished')
    performance.measure('middle-edit-transaction', 'edit-start', 'edit-finished')
  } else {
    log('read-only QA mode: skipped synthetic edit')
  }

  performance.mark('jump-end-start')
  view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  performance.mark('jump-end-finished')
  performance.measure('jump-to-document-end', 'jump-end-start', 'jump-end-finished')

  // Wait longer this time to catch any async highlight tail settling.
  await new Promise((r) => setTimeout(r, 3000))
  performance.mark('settle-3000ms')
  performance.measure('mount-call-to-settle', 'mount-start', 'settle-3000ms')

  const domNodes = document.querySelectorAll('#root *').length
  const mountedLines = document.querySelectorAll('#root .cm-line').length

  const marks = performance.getEntriesByType('mark')
  const measures = performance.getEntriesByType('measure')
  log('\n--- marks (ms since navigation start) ---')
  for (const m of marks) log(`${m.name.padEnd(28)} ${m.startTime.toFixed(1)}`)
  log('\n--- measures ---')
  for (const m of measures) log(`${m.name.padEnd(28)} ${m.duration.toFixed(1)} ms`)
  log(`\nDOM nodes under #root: ${domNodes}`)
  log(`Mounted CM6 lines: ${mountedLines} / ${view.state.doc.lines}`)
}

void main()
