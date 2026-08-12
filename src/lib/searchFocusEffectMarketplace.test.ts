import { describe, expect, it } from 'vitest'
import { searchFocusEffectInstallRequestFromUrl } from './searchFocusEffectMarketplace'

describe('search focus effect marketplace deep links', () => {
  it('parses a complete install request', () => {
    expect(
      searchFocusEffectInstallRequestFromUrl(
        'xiangzi-md://focus-effect/install?id=aurora-pulse&name=%E6%9E%81%E5%85%89%E8%84%89%E5%86%B2&version=1.0.0&author=Xiangzi&effect=ring&url=https%3A%2F%2Fxz.xzfast.top%2Ffocus-effects%2Faurora-pulse.css',
      ),
    ).toEqual({
      id: 'aurora-pulse',
      name: '极光脉冲',
      version: '1.0.0',
      author: 'Xiangzi',
      effect: 'ring',
      sourceUrl: 'https://xz.xzfast.top/focus-effects/aurora-pulse.css',
    })
  })

  it('rejects unrelated, incomplete, and unsupported links', () => {
    expect(searchFocusEffectInstallRequestFromUrl('https://xz.xzfast.top/md/themes')).toBeNull()
    expect(
      searchFocusEffectInstallRequestFromUrl('xiangzi-md://focus-effect/install?id=a'),
    ).toBeNull()
    expect(
      searchFocusEffectInstallRequestFromUrl(
        'xiangzi-md://focus-effect/install?id=a&name=A&version=1&author=A&effect=off&url=https%3A%2F%2Fxz.xzfast.top%2Ffocus-effects%2Fa.css',
      ),
    ).toBeNull()
    expect(
      searchFocusEffectInstallRequestFromUrl(
        'xiangzi-md://focus-effect/install?id=a&name=A&version=1&author=A&effect=unknown&url=https%3A%2F%2Fxz.xzfast.top%2Ffocus-effects%2Fa.css',
      ),
    ).toBeNull()
  })
})
