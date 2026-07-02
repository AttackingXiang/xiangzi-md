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
    dirty: current.revision !== snapshot.revision || current.content !== snapshot.content,
    version,
  }
}
