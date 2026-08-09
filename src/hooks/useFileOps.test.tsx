// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileVersion } from '../platform/contracts'
import type { Tab } from '../types'
import { useFileOps } from './useFileOps'

const desktopMock = vi.hoisted(() => ({
  notify: vi.fn(),
  readFile: vi.fn(),
  openFile: vi.fn(),
  writeFile: vi.fn(),
  pickSavePath: vi.fn(),
  watchPaths: vi.fn(),
}))

vi.mock('../platform', () => ({ desktop: desktopMock }))

const version = (hash: string): FileVersion => ({
  sizeBytes: 4,
  modifiedNanos: 1,
  contentHash: hash,
})

function savedTab(id: string, path: string, content = 'text'): Tab {
  return {
    id,
    path,
    name: path.split(/[\\/]/).pop() ?? 'note.md',
    content,
    savedContent: 'old',
    dirty: true,
    revision: 1,
    version: null,
    eol: 'lf',
  }
}

type Controller = ReturnType<typeof useFileOps>
let controller: Controller | null = null

function captureController(value: Controller): void {
  controller = value
}

function Fixture({ onController }: { onController: (value: Controller) => void }): null {
  const value = useFileOps({
    lang: 'zh',
    requestCloseDecision: () => Promise.resolve('cancel'),
    recordDocEdit: () => undefined,
  })
  useEffect(() => onController(value), [onController, value])
  return null
}

beforeEach(() => {
  controller = null
  desktopMock.notify.mockReset().mockResolvedValue(undefined)
  desktopMock.readFile.mockReset()
  desktopMock.openFile.mockReset().mockResolvedValue(null)
  desktopMock.writeFile
    .mockReset()
    .mockResolvedValue({ path: '/notes/a.md', version: version('a') })
  desktopMock.pickSavePath.mockReset().mockResolvedValue(null)
  desktopMock.watchPaths.mockReset().mockResolvedValue(() => undefined)
})

afterEach(() => {
  controller = null
  document.body.replaceChildren()
})

function mount(): { root: ReturnType<typeof createRoot> } {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<Fixture onController={captureController} />))
  return { root }
}

describe('useFileOps document operation outcomes', () => {
  it('reports an unavailable path instead of resolving as if it had opened', async () => {
    const { root } = mount()
    desktopMock.readFile.mockRejectedValue(new Error('missing'))

    const result = await act(async () => controller?.openPath('/notes/missing.md'))
    expect(result).toEqual({
      kind: 'failed',
      path: '/notes/missing.md',
      reason: 'unavailable',
    })
    expect(controller?.tabs).toEqual([])

    act(() => root.unmount())
  })

  it('refuses Save As when another tab already owns the selected path', async () => {
    const { root } = mount()
    act(() => {
      controller?.setTabs([
        savedTab('source', 'C:\\Notes\\Source.md'),
        savedTab('existing', 'C:\\Notes\\Target.MD'),
      ])
      controller?.setActiveId('source')
    })
    desktopMock.pickSavePath.mockResolvedValue('c:\\notes\\target.md')

    const result = await act(async () => controller?.saveAsTab('source'))
    expect(result).toEqual({
      kind: 'duplicate',
      path: 'c:\\notes\\target.md',
      tabId: 'source',
      existingTabId: 'existing',
    })
    expect(desktopMock.writeFile).not.toHaveBeenCalled()
    expect(controller?.activeId).toBe('existing')

    act(() => root.unmount())
  })

  it('reserves a new Save As target while another tab is still writing it', async () => {
    const { root } = mount()
    act(() => {
      controller?.setTabs([
        savedTab('first', '/notes/first.md', 'first'),
        savedTab('second', '/notes/second.md', 'second'),
      ])
      controller?.setActiveId('first')
    })
    desktopMock.pickSavePath.mockResolvedValue('/notes/shared.md')

    let finishWrite!: () => void
    const writePending = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    desktopMock.writeFile.mockImplementationOnce(async (path: string) => {
      await writePending
      return { path, version: version('shared') }
    })

    const firstSaveAs = controller!.saveAsTab('first')
    const secondSaveAs = controller!.saveAsTab('second')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(desktopMock.writeFile).toHaveBeenCalledTimes(1)

    finishWrite()
    const [firstResult, secondResult] = await act(async () =>
      Promise.all([firstSaveAs, secondSaveAs]),
    )
    expect(firstResult).toEqual({
      kind: 'saved',
      path: '/notes/shared.md',
      tabId: 'first',
    })
    expect(secondResult).toEqual({
      kind: 'duplicate',
      path: '/notes/shared.md',
      tabId: 'second',
      existingTabId: 'first',
    })
    expect(controller?.tabs.filter((tab) => tab.path === '/notes/shared.md')).toHaveLength(1)

    act(() => root.unmount())
  })

  it('serializes Save As behind an in-flight normal save for the same tab', async () => {
    const { root } = mount()
    act(() => {
      controller?.setTabs([savedTab('source', '/notes/source.md', 'latest')])
      controller?.setActiveId('source')
    })

    let finishFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const order: string[] = []
    desktopMock.writeFile
      .mockImplementationOnce(async () => {
        order.push('save:start')
        await firstWrite
        order.push('save:end')
        return { path: '/notes/source.md', version: version('source') }
      })
      .mockImplementationOnce((path: string) => {
        order.push(`write:${path}`)
        return Promise.resolve({ path, version: version('copy') })
      })
    desktopMock.pickSavePath.mockImplementation(() => {
      order.push('pick')
      return Promise.resolve('/notes/copy.md')
    })

    const normalSave = controller?.saveTab('source')
    const saveAs = controller?.saveAsTab('source')
    expect(order).toEqual(['save:start'])

    finishFirst()
    await act(async () => Promise.all([normalSave, saveAs]))
    expect(order).toEqual(['save:start', 'save:end', 'pick', 'write:/notes/copy.md'])
    expect(controller?.tabs[0]?.path).toBe('/notes/copy.md')

    act(() => root.unmount())
  })
})
