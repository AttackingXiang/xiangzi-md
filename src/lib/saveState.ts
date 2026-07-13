import type { FileVersion } from '../platform/contracts'
import type { Tab } from '../types'

export function completeSave(
  current: Tab,
  snapshot: Pick<Tab, 'content' | 'revision'>,
  version: FileVersion,
): Tab {
  return {
    ...current,
    savedContent: snapshot.content,
    // Content is the authority for dirty state. A user can edit and undo back to
    // the exact snapshot while the disk write is in flight; the newer revision
    // number must not make that byte-identical document look unsaved.
    dirty: current.content !== snapshot.content,
    version,
  }
}

/** Applies an editor transaction to a tab without manufacturing a revision. */
export function updateTabContent(current: Tab, content: string): Tab {
  if (content === current.content) return current
  return {
    ...current,
    content,
    dirty: content !== current.savedContent,
    revision: current.revision + 1,
  }
}

/**
 * Merges a transform that was written directly to disk (for example a bulk tag
 * rename) back into an open tab. User edits made while the write was pending
 * always win in memory and remain dirty against the new disk baseline.
 */
export function completePersistedTransform(
  current: Tab,
  baseContent: string,
  persistedContent: string,
  version: FileVersion,
): Tab {
  if (current.content !== baseContent) {
    return {
      ...current,
      savedContent: persistedContent,
      dirty: current.content !== persistedContent,
      version,
    }
  }
  return {
    ...current,
    content: persistedContent,
    savedContent: persistedContent,
    dirty: false,
    revision: current.revision + (persistedContent === baseContent ? 0 : 1),
    version,
  }
}
