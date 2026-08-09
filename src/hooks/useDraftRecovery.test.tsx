// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft, DraftSummary, Tab } from '../types'
import type { DraftRecoveryResult } from '../lib/draftRecovery'
import { useDraftRecovery } from './useDraftRecovery'

const desktopMock = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  readDraft: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
}))

vi.mock('../platform', () => ({ desktop: desktopMock }))

const summary: DraftSummary = {
  id: 'stored-draft',
  path: '/notes/a.md',
  name: 'a.md',
  preview: 'recovered text',
  sizeBytes: 14,
  updatedAt: 1,
}

const draft: Draft = {
  id: summary.id,
  path: summary.path,
  name: summary.name,
  content: 'recovered text',
  updatedAt: summary.updatedAt,
}

function tab(dirty: boolean): Tab {
  return {
    id: 'runtime-tab',
    path: '/notes/a.md',
    name: 'a.md',
    content: dirty ? 'recovered text' : 'saved text',
    savedContent: 'saved text',
    dirty,
    revision: dirty ? 1 : 2,
    version: null,
  }
}

type Controller = ReturnType<typeof useDraftRecovery>
let controller: Controller | null = null

function Fixture({
  tabs,
  recover,
  onController,
}: {
  tabs: Tab[]
  recover: (value: Draft) => Promise<DraftRecoveryResult>
  onController: (value: Controller) => void
}): null {
  const value = useDraftRecovery({
    tabs,
    getCurrentTabs: () => tabs,
    openRecoveredDraft: recover,
  })
  useEffect(() => onController(value), [onController, value])
  return null
}

function captureController(value: Controller): void {
  controller = value
}

async function renderFixture(
  root: Root,
  tabs: Tab[],
  recover: (value: Draft) => Promise<DraftRecoveryResult>,
): Promise<void> {
  await act(async () => {
    root.render(<Fixture tabs={tabs} recover={recover} onController={captureController} />)
    await Promise.resolve()
  })
}

beforeEach(() => {
  controller = null
  desktopMock.listDrafts.mockReset().mockResolvedValue([summary])
  desktopMock.readDraft.mockReset().mockResolvedValue(draft)
  desktopMock.saveDraft.mockReset().mockResolvedValue(summary)
  desktopMock.deleteDraft.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  controller = null
  document.body.replaceChildren()
})

describe('useDraftRecovery recovery outcomes', () => {
  it('keeps a blocked draft visible and never claims it for deletion', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const recover = vi.fn().mockResolvedValue({
      kind: 'blocked',
      tabId: 'runtime-tab',
      reason: 'dirty-existing-path',
    } satisfies DraftRecoveryResult)

    await renderFixture(root, [tab(true)], recover)
    expect(controller?.drafts).toEqual([summary])

    await act(async () => controller?.recover(summary))
    expect(controller?.drafts).toEqual([summary])

    await renderFixture(root, [tab(false)], recover)
    expect(desktopMock.deleteDraft).not.toHaveBeenCalled()

    act(() => root.unmount())
  })

  it('keeps a recovered source snapshot until its different runtime tab becomes clean', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const recover = vi
      .fn()
      .mockResolvedValue({ kind: 'recovered', tabId: 'runtime-tab' } satisfies DraftRecoveryResult)

    await renderFixture(root, [tab(true)], recover)
    await act(async () => controller?.recover(summary))
    expect(controller?.drafts).toEqual([])

    await renderFixture(root, [tab(true)], recover)
    expect(desktopMock.deleteDraft).not.toHaveBeenCalled()

    await renderFixture(root, [tab(false)], recover)
    await act(async () => Promise.resolve())
    expect(desktopMock.deleteDraft).toHaveBeenCalledWith(summary.id)

    act(() => root.unmount())
  })
})
