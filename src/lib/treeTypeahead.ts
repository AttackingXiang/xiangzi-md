/** 连续输入的间隔上限；超过就当作新的一次查找。 */
const RESET_MS = 600

let buffer = ''
let lastAt = 0

/**
 * 文件树的首字母跳转。
 *
 * 缓冲区是模块级的：一棵树里每一行各自绑定 keydown，共享同一次输入序列才能
 * 把「d」「o」「c」连成 "doc"。同一时刻只有一棵文件树，不需要按实例隔离。
 */
export function pushTypeaheadChar(char: string, now: number = Date.now()): string {
  if (now - lastAt > RESET_MS) buffer = ''
  lastAt = now
  buffer += char.toLowerCase()
  return buffer
}

export function resetTypeahead(): void {
  buffer = ''
  lastAt = 0
}

/**
 * 在 `names` 里找下一个以 `query` 开头的条目，从 `from` 之后开始并回绕。
 *
 * 连按同一个字母（"aa"、"aaa"）视为「在以该字母开头的条目之间循环」，
 * 这是各家树控件的通行行为——否则第二次按下就再也匹配不上了。
 */
export function nextTypeaheadIndex(
  names: readonly string[],
  from: number,
  query: string,
): number | null {
  if (!query) return null
  const repeated = query.length > 1 && [...query].every((char) => char === query[0])
  const needle = repeated ? query.slice(0, 1) : query
  // 单字符（含连按）从下一项开始找，多字符查询要能命中当前项，
  // 否则边打字边缩小范围时会跳过正确答案。
  const start = needle.length === 1 ? from + 1 : from

  for (let step = 0; step < names.length; step += 1) {
    const index = (start + step + names.length) % names.length
    if (names[index]?.toLowerCase().startsWith(needle)) return index
  }
  return null
}

/** 只有单个可打印字符、且没按修饰键时才算作首字母跳转。 */
export function isTypeaheadKey(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return (
    event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
  )
}
