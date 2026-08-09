// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '../types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const desktop = vi.hoisted(() => ({
  readDir: vi.fn(),
  openWithDefault: vi.fn(),
}))
vi.mock('../platform', () => ({ desktop }))

import FileTree from './FileTree'

const directory: FileNode = {
  name: 'images',
  path: '/notes/images',
  isDir: true,
  openable: false,
  modifiedNanos: 0,
}
const child: FileNode = {
  name: 'notes.md',
  path: '/notes/images/notes.md',
  isDir: false,
  openable: true,
  modifiedNanos: 0,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

function renderTree(): void {
  act(() =>
    root.render(
      <FileTree
        nodes={[directory]}
        activePath={null}
        revealPath={null}
        revealRequestId={null}
        onRevealComplete={vi.fn()}
        hideFolderNames={[]}
        sortContext={{ mode: 'default', pinnedPaths: new Set(), recentRank: new Map() }}
        onOpenFile={vi.fn()}
        onNodeContext={vi.fn()}
        onMove={vi.fn()}
        rootPath="/notes"
        depth={0}
        expandedPaths={new Set()}
        onToggleExpanded={vi.fn()}
        onFocusPath={vi.fn()}
      />,
    ),
  )
}

describe('FileTree lazy directory errors', () => {
  it('shows a retry action instead of misreporting a failed read as an empty folder', async () => {
    desktop.readDir
      .mockRejectedValueOnce(new Error('permission lost'))
      .mockResolvedValueOnce([child])
    renderTree()

    await act(async () => {
      host.querySelector<HTMLElement>('.tree-row.dir')?.click()
      await Promise.resolve()
    })
    expect(host.textContent).toContain('读取失败，点击重试')
    expect(host.textContent).not.toContain('空文件夹')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.tree-error-row')?.click()
      await Promise.resolve()
    })
    expect(host.textContent).toContain('notes.md')
    expect(host.querySelector('.tree-error-row')).toBeNull()
  })

  it('includes the retry action in arrow-key tree navigation and retries with Enter', async () => {
    desktop.readDir
      .mockRejectedValueOnce(new Error('permission lost'))
      .mockResolvedValueOnce([child])
    renderTree()

    const folderRow = host.querySelector<HTMLElement>('.tree-row.dir')
    await act(async () => {
      folderRow?.click()
      await Promise.resolve()
    })
    const retryRow = host.querySelector<HTMLButtonElement>('.tree-error-row')
    expect(retryRow?.getAttribute('role')).toBe('treeitem')

    folderRow?.focus()
    act(() => {
      folderRow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(retryRow)

    await act(async () => {
      retryRow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })
    expect(host.textContent).toContain('notes.md')
  })
})
