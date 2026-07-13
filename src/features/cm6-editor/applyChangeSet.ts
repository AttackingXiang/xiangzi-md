import type { ChangeSet } from '@codemirror/state'

/**
 * Applies a CM6 ChangeSet to the controller's authoritative string mirror.
 *
 * The hot path deliberately never flattens `state.doc`. Only inserted Text
 * fragments are materialized, then joined with unchanged slices of the mirror.
 */
export function applyChangeSetToString(source: string, changes: ChangeSet): string {
  if (source.length !== changes.length) {
    throw new RangeError(
      `CM6 mirror length mismatch: mirror=${source.length}, changes=${changes.length}`,
    )
  }
  if (changes.empty) return source

  const fragments: string[] = []
  let cursor = 0
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (cursor < fromA) fragments.push(source.slice(cursor, fromA))
    if (inserted.length) fragments.push(inserted.sliceString(0, inserted.length))
    cursor = toA
  })
  if (cursor < source.length) fragments.push(source.slice(cursor))
  return fragments.join('')
}
