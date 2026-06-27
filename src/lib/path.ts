/** 跨平台路径工具：同时兼容 POSIX 的 / 与 Windows 的 \ */

function lastSep(p: string): number {
  return Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
}

/** 取文件名（含扩展名） */
export function baseName(p: string): string {
  if (!p) return p
  const i = lastSep(p)
  return i < 0 ? p : p.slice(i + 1)
}

/** 取所在目录；无目录返回 null */
export function dirName(p: string | null): string | null {
  if (!p) return null
  const i = lastSep(p)
  if (i < 0) return null
  if (i === 0) return '/' // POSIX 根
  // Windows 盘符根，如 C:\ 或 C:/
  if (/^[A-Za-z]:$/.test(p.slice(0, i))) return p.slice(0, i + 1)
  return p.slice(0, i)
}
