import type { FileVersion, OpenedFile } from '../platform/contracts'
import type { Tab } from '../types'
import { detectLineEnding } from './lineEndings'

export type ExternalReadOutcome = 'unchanged' | 'reloaded' | 'conflict'

export interface ExternalReadResult {
  tab: Tab
  outcome: ExternalReadOutcome
}

export function acceptExternalRead(current: Tab, file: OpenedFile): Tab {
  return {
    ...current,
    content: file.content,
    savedContent: file.content,
    dirty: false,
    revision: current.revision + (current.content === file.content ? 0 : 1),
    version: file.version,
    eol: detectLineEnding(file.content),
    diskState: undefined,
  }
}

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
    diskState: undefined,
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

/** Reconciles a verified disk read without ever overwriting unsaved editor content. */
export function reconcileExternalRead(current: Tab, file: OpenedFile): ExternalReadResult {
  if (current.version?.contentHash === file.version.contentHash) {
    if (!current.diskState) return { tab: current, outcome: 'unchanged' }
    return { tab: { ...current, diskState: undefined }, outcome: 'unchanged' }
  }

  if (current.dirty) {
    if (
      current.diskState?.kind === 'changed' &&
      current.diskState.snapshot.version.contentHash === file.version.contentHash
    ) {
      return { tab: current, outcome: 'conflict' }
    }
    return {
      tab: { ...current, diskState: { kind: 'changed', snapshot: file } },
      outcome: 'conflict',
    }
  }

  return {
    tab: acceptExternalRead(current, file),
    outcome: 'reloaded',
  }
}

export function markExternalUnavailable(current: Tab, detectedAt: number): Tab {
  if (current.diskState?.kind === 'unavailable') return current
  return { ...current, diskState: { kind: 'unavailable', detectedAt } }
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
      diskState: undefined,
    }
  }
  return {
    ...current,
    content: persistedContent,
    savedContent: persistedContent,
    dirty: false,
    revision: current.revision + (persistedContent === baseContent ? 0 : 1),
    version,
    diskState: undefined,
  }
}
