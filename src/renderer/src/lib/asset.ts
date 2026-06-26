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
  // Windows 保留盘符前缀（C:/...），POSIX 保留根斜杠（/...）
  return isWin ? out.join('/') : '/' + out.join('/')
}

function isAbsolute(src: string): boolean {
  return src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src) || src.startsWith('\\\\')
}

/**
 * 把 Markdown 中的图片/资源 src 解析成可在渲染层显示的 URL。
 * - http(s)/data/blob/xmd：原样返回
 * - file://、绝对路径、相对 docDir 的路径：转成 xmd:// 协议
 * 兼容 macOS / Windows 路径分隔符。
 */
export function resolveAssetURL(docDir: string | null, src: string): string {
  if (!src) return src
  if (/^(https?|data|blob|xmd):/i.test(src)) return src

  let abs: string | null = null
  if (src.startsWith('file://')) {
    let p = decodeURIComponent(src.replace(/^file:\/\//, ''))
    // Windows 文件 URL 形如 file:///C:/x -> /C:/x，去掉多余的前导斜杠
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    abs = normalize(p)
  } else if (isAbsolute(src)) {
    abs = normalize(src)
  } else if (docDir) {
    abs = normalize(`${docDir}/${src}`)
  }

  if (!abs) return src
  return `xmd://local/${encodeURIComponent(abs)}`
}
