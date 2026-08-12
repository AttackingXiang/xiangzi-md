import type { SearchFocusEffectInstallRequest } from '../platform/contracts'
import { SEARCH_FOCUS_EFFECT_PRESETS } from './searchFocusEffect'

export const SEARCH_FOCUS_EFFECT_GALLERY_URL = 'https://xz.xzfast.top/md/themes#focus-effects'

export function searchFocusEffectInstallRequestFromUrl(
  raw: string,
): SearchFocusEffectInstallRequest | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'xiangzi-md:' ||
    url.hostname !== 'focus-effect' ||
    url.pathname !== '/install'
  ) {
    return null
  }
  const request = {
    id: url.searchParams.get('id')?.trim() ?? '',
    name: url.searchParams.get('name')?.trim() ?? '',
    version: url.searchParams.get('version')?.trim() ?? '',
    author: url.searchParams.get('author')?.trim() ?? '',
    effect: url.searchParams.get('effect')?.trim() ?? '',
    sourceUrl: url.searchParams.get('url')?.trim() ?? '',
  }
  if (!Object.values(request).every(Boolean)) return null
  if (request.effect === 'off' || !(request.effect in SEARCH_FOCUS_EFFECT_PRESETS)) return null
  return request as SearchFocusEffectInstallRequest
}
