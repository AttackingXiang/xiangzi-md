import { describe, expect, it } from 'vitest'
import { themeInstallRequestFromUrl } from './themeMarketplace'

describe('theme marketplace deep links', () => {
  it('parses a complete install request', () => {
    expect(
      themeInstallRequestFromUrl(
        'xiangzi-md://theme/install?id=morandi&name=%E8%8E%AB%E5%85%B0%E8%BF%AA&version=1.0.0&author=Xiangzi&colorScheme=light&url=https%3A%2F%2Fxz.xzfast.top%2Fthemes%2Fmorandi.css',
      ),
    ).toEqual({
      id: 'morandi',
      name: '莫兰迪',
      version: '1.0.0',
      author: 'Xiangzi',
      colorScheme: 'light',
      sourceUrl: 'https://xz.xzfast.top/themes/morandi.css',
    })
  })

  it('rejects unrelated or incomplete links', () => {
    expect(themeInstallRequestFromUrl('https://xz.xzfast.top/themes/')).toBeNull()
    expect(themeInstallRequestFromUrl('xiangzi-md://theme/install?id=morandi')).toBeNull()
    expect(themeInstallRequestFromUrl('xiangzi-md://document/open?id=morandi')).toBeNull()
  })
})
