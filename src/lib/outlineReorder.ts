import { editorBridge } from './editorBridge'
import type { Node } from '@milkdown/kit/prose/model'

/** Absolute end position of the heading's section (content until next same-or-higher heading). */
function getSectionEnd(doc: Node, headingPos: number, level: number): number {
  let pos = 0
  let past = false
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (pos === headingPos) {
      past = true
    } else if (past && child.type.name === 'heading' && (child.attrs.level as number) <= level) {
      return pos
    }
    pos += child.nodeSize
  }
  return doc.content.size
}

/** Collect [pos, level] for every top-level heading, in document order. */
function collectHeadings(doc: Node): Array<{ pos: number; level: number }> {
  const result: Array<{ pos: number; level: number }> = []
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (child.type.name === 'heading') result.push({ pos, level: child.attrs.level as number })
    pos += child.nodeSize
  }
  return result
}

/**
 * Move the section at `fromIndex` (by heading order) to just before the section
 * at `toIndex`, dispatching a ProseMirror transaction.
 */
export function reorderHeadingSections(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return
  const view = editorBridge.get()
  if (!view) return

  const { state } = view
  const headings = collectHeadings(state.doc)
  if (fromIndex >= headings.length || toIndex >= headings.length) return

  const src = headings[fromIndex]
  const tgt = headings[toIndex]
  const srcEnd = getSectionEnd(state.doc, src.pos, src.level)
  const srcSlice = state.doc.slice(src.pos, srcEnd)

  const tr = state.tr

  if (fromIndex < toIndex) {
    // Moving down: insert after target section, then delete original
    const tgtEnd = getSectionEnd(state.doc, tgt.pos, tgt.level)
    tr.insert(tgtEnd, srcSlice.content)
    tr.delete(src.pos, srcEnd)
  } else {
    // Moving up: delete original first, then insert at (now-shifted) target pos
    tr.delete(src.pos, srcEnd)
    const newTgtPos = tr.mapping.map(tgt.pos)
    tr.insert(newTgtPos, srcSlice.content)
  }

  view.dispatch(tr)
}
