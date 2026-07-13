import type { ChangeSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export interface SourceHeading {
  level: number
  text: string
  offset: number
}

export interface HeadingReorderPlan {
  markdown: string
  change: ChangeSpec
}

/** Parse ATX headings while keeping offsets in the original source. */
export function sourceHeadings(markdown: string): SourceHeading[] {
  const headings: SourceHeading[] = []
  const linePattern = /.*(?:\n|$)/g
  let fence: { marker: '`' | '~'; length: number } | null = null
  for (const match of markdown.matchAll(linePattern)) {
    if (!match[0]) continue
    const offset = match.index
    const line = match[0].endsWith('\n') ? match[0].slice(0, -1) : match[0]
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (
        marker === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ''
      )
        fence = null
      continue
    }
    if (fence) continue
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (heading) headings.push({ level: heading[1].length, text: heading[2].trim(), offset })
  }
  return headings
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
  const plan = planHeadingReorder(view.state.doc.toString(), fromIndex, toIndex)
  if (!plan) return false
  view.dispatch({ changes: plan.change })
  view.focus()
  return true
}

/** Reveal a source heading even when no live-preview DOM exists for it yet. */
export function revealHeading(view: EditorView, offset: number): boolean {
  if (!Number.isFinite(offset)) return false
  const position = Math.max(0, Math.min(Math.trunc(offset), view.state.doc.length))
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 24 }),
  })
  view.focus()
  return true
}
