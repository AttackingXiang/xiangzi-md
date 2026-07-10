/**
 * 文本保真：CodeMirror 内部统一用 \n 作为行分隔，且不理解 UTF-8 BOM。为满足
 * 「不主动改写原文」的要求，打开文件时把 BOM 和主导换行符剥离记下来，编辑期间
 * 只在编辑器里用规范化文本，回写 tab.content 时再按原样重新组装。未编辑的文件
 * 因此能逐字节 round-trip，脏状态判断（content === savedContent）不被误触发。
 */
export interface TextEnvelope {
  /** 原文是否以 UTF-8 BOM 开头 */
  bom: boolean
  /** 主导换行符：CRLF 文件保存回 CRLF，其余用 LF */
  eol: '\n' | '\r\n'
}

export interface UnwrappedText extends TextEnvelope {
  /** 已剥离 BOM、换行归一为 \n 的正文，供 CodeMirror 使用 */
  text: string
}

/** U+FEFF ZERO WIDTH NO-BREAK SPACE（UTF-8 BOM 在 JS 字符串中的形式） */
const BOM_CHAR = String.fromCharCode(0xfeff)

/** 从磁盘原文中剥离 BOM 与换行差异，返回信封 + 归一化正文。 */
export function unwrapText(raw: string): UnwrappedText {
  const bom = raw.charCodeAt(0) === 0xfeff
  const body = bom ? raw.slice(1) : raw
  const crlf = (body.match(/\r\n/g) ?? []).length
  const lfOnly = (body.match(/(?<!\r)\n/g) ?? []).length
  const eol: '\n' | '\r\n' = crlf > lfOnly ? '\r\n' : '\n'
  const text = body.replace(/\r\n?/g, '\n')
  return { bom, eol, text }
}

/** 把编辑器里的 \n 文本按信封重新组装成磁盘原样格式。 */
export function wrapText(env: TextEnvelope, text: string): string {
  const body = env.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
  return env.bom ? BOM_CHAR + body : body
}
