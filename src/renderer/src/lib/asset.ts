/** 规范化 POSIX 路径，处理 . 与 .. */
function normalizePosix(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

/**
 * 把 Markdown 中的图片/资源 src 解析成可在渲染层显示的 URL。
 * - http(s)/data/blob/xmd：原样返回
 * - file://、绝对路径、相对 docDir 的路径：转成 xmd:// 协议
 */
export function resolveAssetURL(docDir: string | null, src: string): string {
  if (!src) return src
  if (/^(https?|data|blob|xmd):/i.test(src)) return src

  let abs: string | null = null
  if (src.startsWith('file://')) {
    abs = decodeURIComponent(src.replace(/^file:\/\//, ''))
  } else if (src.startsWith('/')) {
    abs = src
  } else if (docDir) {
    abs = normalizePosix(`${docDir}/${src}`)
  }

  if (!abs) return src
  return `xmd://local/${encodeURIComponent(abs)}`
}
