import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../types'
import { affectedTabIds, removeWorkspacePath } from './workspaceRemoval'

const tabs: Tab[] = [
  {
    id: 'inside',
    path: '/notes/topic/a.md',
    name: 'a.md',
    content: 'changed',
    savedContent: '',
    dirty: true,
    revision: 1,
    version: null,
  },
  {
    id: 'outside',
    path: '/notes/b.md',
    name: 'b.md',
    content: '',
    savedContent: '',
    dirty: false,
    revision: 0,
    version: null,
  },
]

describe('workspace removal', () => {
  it('identifies tabs opened from a removed file or directory', () => {
    expect(affectedTabIds(tabs, '/notes/topic')).toEqual(['inside'])
    expect(affectedTabIds(tabs, '/notes/topic/a.md')).toEqual(['inside'])
  })

  it('does not mutate the workspace when closing dirty tabs is cancelled', async () => {
    const services = {
      confirmCloseTabs: vi.fn().mockResolvedValue(false),
      trash: vi.fn(),
      closeTabsWithoutPrompt: vi.fn(),
      refreshTree: vi.fn(),
    }

    await expect(removeWorkspacePath('/notes/topic', tabs, services)).resolves.toBe(false)
    expect(services.trash).not.toHaveBeenCalled()
    expect(services.closeTabsWithoutPrompt).not.toHaveBeenCalled()
  })

  it('closes tabs only after the filesystem mutation succeeds', async () => {
    const order: string[] = []
    const services = {
      confirmCloseTabs: vi.fn(() => {
        order.push('confirm')
        return Promise.resolve(true)
      }),
      trash: vi.fn(() => {
        order.push('trash')
        return Promise.resolve()
      }),
      closeTabsWithoutPrompt: vi.fn(() => order.push('close-tabs')),
      refreshTree: vi.fn(() => {
        order.push('refresh')
        return Promise.resolve()
      }),
    }

    await expect(removeWorkspacePath('/notes/topic', tabs, services)).resolves.toBe(true)
    expect(order).toEqual(['confirm', 'trash', 'close-tabs', 'refresh'])

    services.trash.mockRejectedValueOnce(new Error('disk error'))
    services.closeTabsWithoutPrompt.mockClear()
    await expect(removeWorkspacePath('/notes/topic', tabs, services)).rejects.toThrow('disk error')
    expect(services.closeTabsWithoutPrompt).not.toHaveBeenCalled()
  })
})
