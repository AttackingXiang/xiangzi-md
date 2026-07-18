export interface IntrinsicColumnWidth {
  min: number
  preferred: number
}

const HARD_MIN_COLUMN = 48

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Round tracks without dumping the entire rounding error into one column. */
function roundTracks(values: number[], target?: number): number[] {
  const rounded = values.map(Math.floor)
  if (target === undefined || rounded.length === 0) return rounded
  let remainder = Math.round(target) - rounded.reduce((sum, value) => sum + value, 0)
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    rounded[order[i % order.length].index] += 1
  }
  for (let i = order.length - 1; remainder < 0; i -= 1, remainder += 1) {
    const entry = order[(i + order.length) % order.length]
    if (rounded[entry.index] > 0) rounded[entry.index] -= 1
  }
  return rounded
}

function interpolate(base: number[], limits: number[], amount: number): number[] {
  const capacity = limits.reduce((sum, limit, index) => sum + Math.max(0, limit - base[index]), 0)
  if (capacity <= 0) return base
  return base.map((value, index) => {
    const growth = Math.max(0, limits[index] - value)
    return value + (amount * growth) / capacity
  })
}

/**
 * Satisfy min-content tracks first, grow toward max-content in proportion to
 * each track's growth potential, then share any remaining space equally.
 */
export function fitColumnsToContainer(
  intrinsic: IntrinsicColumnWidth[],
  availableWidth: number,
): number[] {
  if (intrinsic.length === 0) return []
  const available = Math.max(intrinsic.length, Math.floor(availableWidth))
  const hardMin = Math.min(HARD_MIN_COLUMN, Math.floor(available / intrinsic.length))
  const minimums = intrinsic.map(({ min }) => Math.max(hardMin, finite(min, hardMin)))
  const preferred = intrinsic.map(({ preferred: width }, index) =>
    Math.max(minimums[index], finite(width, minimums[index])),
  )
  const minTotal = minimums.reduce((sum, width) => sum + width, 0)
  const preferredTotal = preferred.reduce((sum, width) => sum + width, 0)

  let widths: number[]
  if (available < minTotal) {
    const base = Array<number>(intrinsic.length).fill(hardMin)
    widths = interpolate(base, minimums, available - hardMin * intrinsic.length)
  } else if (available < preferredTotal) {
    widths = interpolate(minimums, preferred, available - minTotal)
  } else {
    const surplus = (available - preferredTotal) / intrinsic.length
    widths = preferred.map((width) => width + surplus)
  }
  return roundTracks(widths, available)
}

/** Fit each track to its preferred content width with spreadsheet-style caps. */
export function fitColumnsToContents(
  intrinsic: IntrinsicColumnWidth[],
  minWidth = 64,
  maxWidth = 640,
): number[] {
  return roundTracks(
    intrinsic.map(({ min, preferred }) =>
      Math.min(Math.max(finite(preferred, minWidth), finite(min, minWidth), minWidth), maxWidth),
    ),
  )
}
