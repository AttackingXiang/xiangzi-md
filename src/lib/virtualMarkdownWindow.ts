export const VIRTUAL_MARKDOWN_CHUNK_CHARS = 10_000
export const EDGE_PRELOAD_VIEWPORTS = 1.25

export function chunkIndexAtOffset(offsets: readonly number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1)
  if (count === 0) return 0
  const target = Math.max(0, Math.min(offset, offsets[count]))
  let low = 0
  let high = count - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (target < offsets[middle]) high = middle - 1
    else if (target >= offsets[middle + 1]) low = middle + 1
    else return middle
  }
  return Math.min(count - 1, Math.max(0, low))
}

/** Select the current chunk and at most one neighbour. The viewport center owns
 * the current chunk. Near an edge we preload that edge's neighbour; if a short
 * chunk is near both edges, only the closer edge wins. */
export function virtualMarkdownWindow(
  offsets: readonly number[],
  viewportTop: number,
  viewportHeight: number,
): number[] {
  const count = Math.max(0, offsets.length - 1)
  if (count === 0) return []
  const center = viewportTop + viewportHeight / 2
  const current = chunkIndexAtOffset(offsets, center)
  const threshold = viewportHeight * EDGE_PRELOAD_VIEWPORTS
  const distanceToTop = Math.max(0, viewportTop - offsets[current])
  const distanceToBottom = Math.max(0, offsets[current + 1] - (viewportTop + viewportHeight))
  const nearTop = current > 0 && distanceToTop <= threshold
  const nearBottom = current < count - 1 && distanceToBottom <= threshold

  if (nearTop && nearBottom) {
    return distanceToTop <= distanceToBottom ? [current - 1, current] : [current, current + 1]
  }
  if (nearTop) return [current - 1, current]
  if (nearBottom) return [current, current + 1]
  return [current]
}
