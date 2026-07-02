export type ExternalLinkDecision =
  | { kind: 'trusted'; url: string; hostname: string }
  | { kind: 'confirm'; url: string; hostname: string }
  | { kind: 'blocked' }

const OFFICIAL_PATHS = new Map([
  ['github.com', '/AttackingXiang/'],
  ['gitee.com', '/tlqgyx/'],
])

/** Parse once and compare normalized host/path values, never display a caller-supplied label. */
export function classifyExternalLink(href: string): ExternalLinkDecision {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { kind: 'blocked' }
  }
  if (url.protocol !== 'https:' || url.username || url.password) return { kind: 'blocked' }
  const hostname = url.hostname.toLowerCase()
  const officialPrefix = OFFICIAL_PATHS.get(hostname)
  const normalizedPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  if (officialPrefix && normalizedPath.startsWith(officialPrefix)) {
    return { kind: 'trusted', url: url.href, hostname }
  }
  return { kind: 'confirm', url: url.href, hostname }
}
