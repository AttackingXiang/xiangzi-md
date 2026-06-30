/** 规范化路径（统一为正斜杠，处理 . 与 ..），兼容 POSIX 与 Windows 盘符 */
function normalize(input: string): string {
  const path = input.replace(/\\/g, '/')
  const isWin = /^[A-Za-z]:/.test(path)
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return isWin ? out.join('/') : '/' + out.join('/')
}

function isAbsolute(src: string): boolean {
  return src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src) || src.startsWith('\\\\')
}

/** 解析 xmd:// 地址中的主路径和备用路径，顺序与 Rust 协议处理器一致。 */
export function xmdAssetPaths(source: string): string[] {
  try {
    const url = new URL(source)
    if (url.protocol !== 'xmd:') return []
    const primary = decodeURIComponent(url.pathname.slice(1))
    const alternatives = (url.searchParams.get('alts') ?? '')
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean)
    return [...new Set([primary, ...alternatives].filter(Boolean))]
  } catch {
    return []
  }
}

export function imageMimeType(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0]
  if (/\.jpe?g$/i.test(cleanPath)) return 'image/jpeg'
  if (/\.gif$/i.test(cleanPath)) return 'image/gif'
  if (/\.webp$/i.test(cleanPath)) return 'image/webp'
  if (/\.svg$/i.test(cleanPath)) return 'image/svg+xml'
  return 'image/png'
}

/**
 * 把 Markdown 中的图片/资源 src 解析成可在渲染层显示的 URL。
 * - http(s)/data/blob/xmd：原样返回
 * - file://、绝对路径、相对 docDir 的路径：转成 xmd:// 协议
 *
 * 当提供 vaultRoot / searchPaths 时，会在 xmd:// URL 中附加备用路径
 * (?alts=…)，供主进程协议处理器依序尝试，从而支持：
 *   - 站点根相对路径（/static/img.png → vaultRoot/static/img.png）
 *   - 图片目录与文档不在同一层级的情况
 */
export function resolveAssetURL(
  docDir: string | null,
  src: string,
  vaultRoot?: string | null,
  searchPaths?: string[],
): string {
  if (!src) return src
  if (/^(https?|data|blob|xmd):/i.test(src)) return src

  let primary: string | null = null

  if (src.startsWith('file://')) {
    let p = decodeURIComponent(src.replace(/^file:\/\//, ''))
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    primary = normalize(p)
  } else if (isAbsolute(src)) {
    primary = normalize(src)
  } else if (docDir) {
    primary = normalize(`${docDir}/${src}`)
  }

  if (!primary) return src

  // Build alternative candidates for paths that may live outside docDir
  const alts: string[] = []
  const seen = new Set<string>([primary])

  const addAlt = (p: string): void => {
    if (!seen.has(p)) {
      seen.add(p)
      alts.push(p)
    }
  }

  if (vaultRoot) {
    if (src.startsWith('/')) {
      // Site-root-relative: /static/img.png → vaultRoot + /static/img.png
      addAlt(normalize(`${vaultRoot}${src}`))
    } else {
      // Relative path: also try from vault root
      addAlt(normalize(`${vaultRoot}/${src}`))
    }
  }

  // User-configured extra search directories
  if (searchPaths) {
    for (const base of searchPaths) {
      const trimmed = base.trim()
      if (trimmed) addAlt(normalize(`${trimmed}/${src}`))
    }
  }

  const primaryUrl = `xmd://localhost/${encodeURIComponent(primary)}`
  if (alts.length === 0) return primaryUrl
  // Encode alt paths as newline-separated query param (URLSearchParams auto-encodes)
  return `${primaryUrl}?alts=${encodeURIComponent(alts.join('\n'))}`
}
