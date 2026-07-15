import { describe, expect, it } from 'vitest'
import { browserDesktopAdapter, createBrowserPreviewSettings } from './browserAdapter'

describe('browser preview adapter', () => {
  it('provides complete settings without Tauri IPC', async () => {
    const defaults = createBrowserPreviewSettings()
    expect(defaults.schemaVersion).toBeGreaterThan(0)
    expect(defaults.showToolbar).toBe(true)
    await expect(browserDesktopAdapter.getSettings()).resolves.toMatchObject({ language: 'zh' })
  })

  it('opens a representative Markdown document and workspace', async () => {
    const file = await browserDesktopAdapter.openFile()
    const folder = await browserDesktopAdapter.openFolder()
    expect(file?.content).toContain('## Mermaid')
    expect(file?.content).toContain('\\frac')
    expect(folder?.tree.some((node) => node.path === file?.path)).toBe(true)
  })

  it('persists preview edits in memory', async () => {
    const file = await browserDesktopAdapter.openFile()
    expect(file).not.toBeNull()
    if (!file) return
    await browserDesktopAdapter.writeFile(file.path, '# Changed', file.version)
    await expect(browserDesktopAdapter.readFile(file.path)).resolves.toMatchObject({
      content: '# Changed',
    })
  })
})
