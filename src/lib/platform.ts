export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

export function detectDesktopPlatform(userAgent: string, platform = ''): DesktopPlatform {
  const value = `${platform} ${userAgent}`.toLocaleLowerCase()
  if (value.includes('windows') || value.includes('win32')) return 'windows'
  if (value.includes('macintosh') || value.includes('mac os') || value.includes('macintel')) {
    return 'macos'
  }
  if (value.includes('linux') || value.includes('x11')) return 'linux'
  return 'unknown'
}

export function currentDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  return detectDesktopPlatform(navigator.userAgent, navigator.platform)
}

export function revealLocationKey(platform = currentDesktopPlatform()): string {
  if (platform === 'windows') return '在文件资源管理器中显示'
  if (platform === 'macos') return '在访达中显示'
  return '在文件管理器中显示'
}
