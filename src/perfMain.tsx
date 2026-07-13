import React from 'react'
import ReactDOM from 'react-dom/client'
import Editor from './components/VirtualizedEditor'
import './styles/index.css'

const logEl = document.getElementById('perf-log')!
function log(msg: string): void {
  logEl.textContent += msg + '\n'
  console.log('[perf]', msg)
}

async function main(): Promise<void> {
  performance.mark('fetch-start')
  const res = await fetch('/perf-test-1mb.md')
  const content = await res.text()
  performance.mark('fetch-end')
  performance.measure('fetch', 'fetch-start', 'fetch-end')
  log(`fetched ${(content.length / 1024).toFixed(0)} KB (${content.length} chars)`)

  performance.mark('mount-start')
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <React.StrictMode>
      <Editor
        content={content}
        docDir={null}
        docName="perf-test-1mb.md"
        vaultRoot={null}
        assetSearchPaths={[]}
        allowRemoteImages={false}
        imageMaxWidth={800}
        focusMode={false}
        typewriterMode={false}
        showSelectionToolbar={true}
        tableAutoWidth="distribute"
        tableAutoResize={true}
        documentKey="perf-test"
        readingMode={false}
        onChange={() => {}}
      />
    </React.StrictMode>,
  )
  performance.mark('render-called')

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  performance.mark('first-2-rafs')
  performance.measure('mount-call-to-2rafs', 'mount-start', 'first-2-rafs')

  // Wait longer this time to catch any async highlight tail settling.
  await new Promise((r) => setTimeout(r, 3000))
  performance.mark('settle-3000ms')
  performance.measure('mount-call-to-settle', 'mount-start', 'settle-3000ms')

  const domNodes = document.querySelectorAll('#root *').length

  const marks = performance.getEntriesByType('mark')
  const measures = performance.getEntriesByType('measure')
  log('\n--- marks (ms since navigation start) ---')
  for (const m of marks) log(`${m.name.padEnd(28)} ${m.startTime.toFixed(1)}`)
  log('\n--- measures ---')
  for (const m of measures) log(`${m.name.padEnd(28)} ${m.duration.toFixed(1)} ms`)
  log(`\nDOM nodes under #root: ${domNodes}`)
}

void main()
