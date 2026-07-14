import type { ChangeSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  markdownHeadingContentOffset,
  markdownHeadingIndex,
  type MarkdownHeading,
} from '../../lib/linkNavigation'
import { cm6ActiveViewBridge } from './activeViewBridge'

export type SourceHeading = MarkdownHeading

export interface HeadingReorderPlan {
  markdown: string
  change: ChangeSpec
}

/** Parse top-level CommonMark headings while keeping original-source offsets. */
export function sourceHeadings(markdown: string): SourceHeading[] {
  return markdownHeadingIndex(markdown, { topLevelOnly: true }).map((heading) => ({
    level: heading.level,
    text: heading.text,
    offset: heading.offset,
  }))
}

function sectionEnd(markdown: string, headings: readonly SourceHeading[], index: number): number {
  const heading = headings[index]
  for (let next = index + 1; next < headings.length; next += 1) {
    if (headings[next].level <= heading.level) return headings[next].offset
  }
  return markdown.length
}

/** Move one complete heading section, including all of its nested headings. */
export function reorderHeadingSource(markdown: string, fromIndex: number, toIndex: number): string {
  if (fromIndex === toIndex) return markdown
  const headings = sourceHeadings(markdown)
  const source = headings[fromIndex]
  const target = headings[toIndex]
  if (!source || !target) return markdown

  const sourceEnd = sectionEnd(markdown, headings, fromIndex)
  const sourceText = markdown.slice(source.offset, sourceEnd)
  const remaining = markdown.slice(0, source.offset) + markdown.slice(sourceEnd)
  if (fromIndex < toIndex) {
    const insertAt = sectionEnd(markdown, headings, toIndex) - sourceText.length
    return remaining.slice(0, insertAt) + sourceText + remaining.slice(insertAt)
  }
  return remaining.slice(0, target.offset) + sourceText + remaining.slice(target.offset)
}

/** Represent a reorder as the smallest single CM6 replacement. */
export function planHeadingReorder(
  markdown: string,
  fromIndex: number,
  toIndex: number,
): HeadingReorderPlan | null {
  const reordered = reorderHeadingSource(markdown, fromIndex, toIndex)
  if (reordered === markdown) return null
  let from = 0
  while (from < markdown.length && from < reordered.length && markdown[from] === reordered[from]) {
    from += 1
  }
  let oldTo = markdown.length
  let newTo = reordered.length
  while (oldTo > from && newTo > from && markdown[oldTo - 1] === reordered[newTo - 1]) {
    oldTo -= 1
    newTo -= 1
  }
  return { markdown: reordered, change: { from, to: oldTo, insert: reordered.slice(from, newTo) } }
}

export function reorderHeading(view: EditorView, fromIndex: number, toIndex: number): boolean {
  if (view.state.readOnly) return false
  const plan = planHeadingReorder(view.state.doc.toString(), fromIndex, toIndex)
  if (!plan) return false
  view.dispatch({ changes: plan.change })
  view.focus()
  return true
}

function stabilizeRevealScroll(view: EditorView, anchor: number, scrollPosition: number): void {
  if (typeof requestAnimationFrame !== 'function') return
  const document = view.state.doc
  let frames = 4
  const afterLayout = (): void => {
    frames -= 1
    if (frames > 0) {
      requestAnimationFrame(afterLayout)
      return
    }
    if (
      cm6ActiveViewBridge.get() !== view ||
      view.state.doc !== document ||
      view.state.selection.main.head !== anchor
    )
      return
    view.dispatch({
      effects: EditorView.scrollIntoView(scrollPosition, { y: 'start', yMargin: 24 }),
    })
  }
  requestAnimationFrame(afterLayout)
}

/** Reveal a source heading even when no live-preview DOM exists for it yet. */
export function revealHeading(view: EditorView, offset: number): boolean {
  if (!Number.isFinite(offset)) return false
  const position = Math.max(0, Math.min(Math.trunc(offset), view.state.doc.length))
  const line = view.state.doc.lineAt(position)
  const atxPrefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line.text)
  const visibleOffset = markdownHeadingContentOffset(line.text)
  const anchor =
    atxPrefix || position === line.from
      ? line.from + (visibleOffset ?? atxPrefix?.[0].length ?? 0)
      : position
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }),
  })
  stabilizeRevealScroll(view, anchor, line.from)
  view.focus()
  return true
}
