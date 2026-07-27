import type { ThemeInstallRequest } from '../platform/contracts'

export const THEME_GALLERY_URL = 'https://xz.xzfast.top/themes'

export function themeInstallRequestFromUrl(raw: string): ThemeInstallRequest | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'xiangzi-md:' || url.hostname !== 'theme' || url.pathname !== '/install') {
    return null
  }
  const request = {
    id: url.searchParams.get('id')?.trim() ?? '',
    name: url.searchParams.get('name')?.trim() ?? '',
    version: url.searchParams.get('version')?.trim() ?? '',
    author: url.searchParams.get('author')?.trim() ?? '',
    colorScheme: url.searchParams.get('colorScheme')?.trim() ?? '',
    sourceUrl: url.searchParams.get('url')?.trim() ?? '',
  }
  if (!Object.values(request).every(Boolean)) return null
  if (request.colorScheme !== 'light' && request.colorScheme !== 'dark') return null
  return request as ThemeInstallRequest
}
