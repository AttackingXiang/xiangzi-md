export function estimateRemainingSeconds(elapsedMs: number, percent: number): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1_000 || percent < 1 || percent >= 100) {
    return undefined
  }
  return Math.max(1, Math.ceil((elapsedMs / 1_000) * ((100 - percent) / percent)))
}
