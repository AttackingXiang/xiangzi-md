import { describe, expect, it } from 'vitest'
import { detectDesktopPlatform, revealLocationKey } from './platform'

describe('desktop platform labels', () => {
  it('uses File Explorer wording on Windows', () => {
    const platform = detectDesktopPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(platform).toBe('windows')
    expect(revealLocationKey(platform)).toBe('在文件资源管理器中显示')
  })

  it('uses Finder wording on macOS', () => {
    const platform = detectDesktopPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(platform).toBe('macos')
    expect(revealLocationKey(platform)).toBe('在访达中显示')
  })
})
