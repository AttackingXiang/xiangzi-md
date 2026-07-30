interface ParsedVersion {
  numbers: number[]
  prerelease: string[] | null
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null

  return {
    numbers: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4]?.split('.') ?? null,
  }
}

function comparePrerelease(left: string[] | null, right: string[] | null): number {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart)
    const rightNumber = /^\d+$/.test(rightPart)
    if (leftNumber && rightNumber) return Number(leftPart) - Number(rightPart)
    if (leftNumber) return -1
    if (rightNumber) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/**
 * Compares the published version against the installed version according to
 * Semantic Version precedence. Invalid versions are deliberately treated as
 * equal so Settings never labels an unknown tag as either an upgrade or a
 * rollback.
 */
export function compareVersions(published: string, installed: string): number {
  const left = parseVersion(published)
  const right = parseVersion(installed)
  if (!left || !right) return 0

  for (let index = 0; index < left.numbers.length; index += 1) {
    const difference = left.numbers[index] - right.numbers[index]
    if (difference !== 0) return difference
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}
