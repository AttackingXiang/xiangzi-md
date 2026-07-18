import { convertFileSrc } from '@tauri-apps/api/core'

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

/**
 * 生成 xmd 协议 URL。macOS/Linux 的 WebView 可直接加载自定义协议
 * （xmd://localhost/…），Windows 的 WebView2 不支持自定义 scheme，Tauri 将其
 * 映射为 http://xmd.localhost/…。convertFileSrc 由运行时注入、按平台返回正确
 * 形式；测试等非 Tauri 环境下回退到 macOS 形式。
 */
function xmdUrl(path: string): string {
  try {
    return convertFileSrc(path, 'xmd')
  } catch {
    return `xmd://localhost/${encodeURIComponent(path)}`
  }
}

/** 是否为 xmd 协议地址（含 Windows 的 http://xmd.localhost 映射形式）。 */
function isXmdUrl(url: URL): boolean {
  return (
    url.protocol === 'xmd:' || (/^https?:$/.test(url.protocol) && url.hostname === 'xmd.localhost')
  )
}

/** 解析 xmd:// 地址中的主路径和备用路径，顺序与 Rust 协议处理器一致。 */
export function xmdAssetPaths(source: string): string[] {
  try {
    const url = new URL(source)
    if (!isXmdUrl(url)) return []
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

/** Detect the validated remote image payload instead of trusting a URL suffix. */
export function imageMimeTypeFromBytes(bytes: Uint8Array, fallbackPath = ''): string {
  if (
    bytes.length >= 8 &&
    bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).startsWith('GIF8')) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 256))).trimStart()
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(prefix)) return 'image/svg+xml'
  return imageMimeType(fallbackPath)
}

/** Reuse an owned ArrayBuffer when possible and copy only shared or sliced views. */
export function blobPartFromBytes(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  // 防御 IPC 边界：tauri::ipc::Response 在前端是 ArrayBuffer，直接透传；
  // 若误走 TypedArray 分支，set() 不会拷贝任何字节，产物会是全零数据。
  if (bytes instanceof ArrayBuffer) return bytes
  if (bytes.buffer instanceof ArrayBuffer) {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  return owned.buffer
}

export const BLOCKED_REMOTE_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'

/** 与 Rust 侧 MAX_ASSET_CANDIDATES 对齐：主路径 + 至多 32 个备选。 */
const MAX_ALT_CANDIDATES = 32

/** 无仓库根时向上探测的最大层数（避免一路爬到用户主目录产生噪声候选）。 */
const MAX_ANCESTOR_LEVELS_WITHOUT_VAULT = 3

/** 越过仓库根后额外探测的层数：用户把某个子文件夹当仓库打开、而图片存放在
 * 上层目录时（Typora 常见布局），仅靠仓库内探测会漏掉真实路径。多探几层的
 * 安全性由协议层兜底——未授权的路径 xmd 处理器本来就不会服务。 */
const MAX_ANCESTOR_LEVELS_BEYOND_VAULT = 2

/**
 * docDir 的祖先目录序列（由近及远）。docDir 在 vaultRoot 之下时走到 vaultRoot
 * 后再额外探 MAX_ANCESTOR_LEVELS_BEYOND_VAULT 层；无仓库时最多向上
 * MAX_ANCESTOR_LEVELS_WITHOUT_VAULT 层。
 * 典型场景：Typora 用户把文档挪进子文件夹，图片还留在原层级的 assets/ 里，
 * 相对路径于是指向文档的某个祖先目录而不是文档所在目录。
 */
function ancestorDirs(docDir: string, vaultRoot?: string | null): string[] {
  const stop = vaultRoot ? normalize(vaultRoot) : null
  const result: string[] = []
  let current = normalize(docDir)
  let beyondVault = stop ? (current === stop ? 0 : -1) : -1
  for (let level = 0; ; level++) {
    const cut = current.lastIndexOf('/')
    if (cut <= 0) break
    const parent = current.slice(0, cut)
    // Windows 盘符根（如 "C:"）或 POSIX 根不再继续
    if (parent === '' || /^[A-Za-z]:$/.test(parent)) break
    if (stop && beyondVault < 0) {
      // 仍在仓库内向上走；到达仓库根后切换到"越根探测"计数
      if (!stop.startsWith(parent) && !parent.startsWith(stop)) break
      result.push(parent)
      if (parent === stop) beyondVault = 0
    } else if (stop) {
      if (beyondVault >= MAX_ANCESTOR_LEVELS_BEYOND_VAULT) break
      result.push(parent)
      beyondVault++
    } else {
      if (level >= MAX_ANCESTOR_LEVELS_WITHOUT_VAULT) break
      result.push(parent)
    }
    current = parent
  }
  return result
}

/**
 * 把 Markdown 中的图片/资源 src 解析成可在渲染层显示的 URL。
 * - http(s)：仅在用户明确允许远程图片时返回，否则替换为本地占位图
 * - data/blob/xmd：原样返回
 * - file://、绝对路径、相对 docDir 的路径：转成 xmd:// 协议
 *
 * 相对路径按以下顺序生成候选，附加在 xmd:// 的 ?alts= 中由主进程依序尝试：
 *   1. 文档所在目录（主路径）
 *   2. 文档目录的各级祖先目录（由近及远，至仓库根为止）——兼容文档被挪入
 *      子文件夹而图片留在原层级的情况
 *   3. 仓库根（含 /static/img.png 这类站点根相对路径）
 *   4. 用户配置的「额外图片搜索目录」
 * 若 src 含百分号编码（如 %20），再补一轮解码后的同序候选，兼容
 * Typora 等编辑器对空格/中文做 URL 编码的写法。
 */
export function resolveAssetURL(
  docDir: string | null,
  src: string,
  vaultRoot?: string | null,
  searchPaths?: string[],
  allowRemoteImages = false,
): string {
  if (!src) return src
  // Windows 上已解析过的 xmd 映射地址（http://xmd.localhost/…）原样放行，
  // 必须先于 https? 远程判断，否则会被误当远程图片拦截。
  if (/^https?:\/\/xmd\.localhost\//i.test(src)) return src
  if (/^https?:/i.test(src)) return allowRemoteImages ? src : BLOCKED_REMOTE_IMAGE
  if (/^(data|blob|xmd):/i.test(src)) return src

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
    if (alts.length >= MAX_ALT_CANDIDATES) return
    if (!seen.has(p)) {
      seen.add(p)
      alts.push(p)
    }
  }

  /** 对一个相对 src，按「祖先目录 → 仓库根 → 额外搜索目录」追加候选。 */
  const addRelativeCandidates = (relSrc: string): void => {
    if (docDir && !isAbsolute(relSrc) && !relSrc.startsWith('file://')) {
      for (const ancestor of ancestorDirs(docDir, vaultRoot)) {
        addAlt(normalize(`${ancestor}/${relSrc}`))
      }
    }
    if (vaultRoot) {
      if (relSrc.startsWith('/')) {
        // Site-root-relative: /static/img.png → vaultRoot + /static/img.png
        addAlt(normalize(`${vaultRoot}${relSrc}`))
      } else {
        addAlt(normalize(`${vaultRoot}/${relSrc}`))
      }
    }
    if (searchPaths) {
      for (const base of searchPaths) {
        const trimmed = base.trim()
        if (trimmed) addAlt(normalize(`${trimmed}/${relSrc}`))
      }
    }
  }

  addRelativeCandidates(src)

  // 含百分号编码的写法（%20、中文转码等）：补一轮解码后的候选
  if (src.includes('%')) {
    try {
      const decoded = decodeURIComponent(src)
      if (decoded !== src) {
        if (docDir && !isAbsolute(decoded)) addAlt(normalize(`${docDir}/${decoded}`))
        addRelativeCandidates(decoded)
      }
    } catch {
      // 非法编码序列：按原样处理即可
    }
  }

  const primaryUrl = xmdUrl(primary)
  if (alts.length === 0) return primaryUrl
  // Encode alt paths as newline-separated query param (URLSearchParams auto-encodes)
  return `${primaryUrl}?alts=${encodeURIComponent(alts.join('\n'))}`
}
