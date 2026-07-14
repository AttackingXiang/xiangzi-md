/** A half-open `[from, to)` span of document positions. */
export interface PreviewRange {
  from: number
  to: number
}

/** Merge overlapping/adjacent ranges. Input does not need to be sorted. */
export function mergeRanges(ranges: readonly PreviewRange[]): PreviewRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: PreviewRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push({ ...range })
  }
  return merged
}

/** Whether two ranges overlap, touching at a shared boundary counts as overlap. */
export function rangesTouch(a: PreviewRange, b: PreviewRange): boolean {
  return a.from <= b.to && a.to >= b.from
}

/** Grow each viewport range by `margin` source characters, then merge overlaps. */
export function expandedVisibleRanges(
  docLength: number,
  ranges: readonly PreviewRange[],
  margin: number,
): PreviewRange[] {
  return mergeRanges(
    ranges.map(({ from, to }) => ({
      from: Math.max(0, from - margin),
      to: Math.min(docLength, to + margin),
    })),
  )
}
