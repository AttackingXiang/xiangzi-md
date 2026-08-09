import { describe, expect, it, vi } from 'vitest'
import { RetriableUndoStack } from './retriableUndo'

describe('RetriableUndoStack', () => {
  it('retains a failed inverse operation so the user can retry', async () => {
    const stack = new RetriableUndoStack<string>()
    stack.push('rename')
    const run = vi.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined)

    await expect(stack.undo(run)).resolves.toMatchObject({ kind: 'failed' })
    expect(stack.canUndo).toBe(true)
    await expect(stack.undo(run)).resolves.toEqual({ kind: 'undone' })
    expect(stack.canUndo).toBe(false)
  })

  it('does not run the same inverse operation concurrently', async () => {
    const stack = new RetriableUndoStack<string>()
    stack.push('move')
    let finish!: () => void
    const active = stack.undo(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )

    await expect(stack.undo(vi.fn())).resolves.toEqual({ kind: 'busy' })
    finish()
    await expect(active).resolves.toEqual({ kind: 'undone' })
  })
})
