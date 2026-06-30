export interface ContentDiffLine {
  type: 'added' | 'removed'
  text: string
  lineNumber: number
}

export interface ContentDiffSummary {
  added: number
  removed: number
  preview: ContentDiffLine[]
  truncated: boolean
}

const MAX_MATRIX_CELLS = 80_000
const MAX_DETAILED_DIFF_CHARS = 4 * 1024 * 1024
const MAX_PREVIEW_LINE_CHARS = 400

function previewText(text: string): string {
  return text.length > MAX_PREVIEW_LINE_CHARS ? `${text.slice(0, MAX_PREVIEW_LINE_CHARS)}…` : text
}

function linesOf(content: string): string[] {
  if (!content) return []
  const normalized = content.replace(/\r\n?/g, '\n')
  // Markdown 编辑器会固定补一个结尾换行，它不代表用户新增了空白行。
  const withoutTerminalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return withoutTerminalNewline ? withoutTerminalNewline.split('\n') : []
}

/** 单边内容使用流式扫描，避免为超大新文档同时创建行数组和差异数组。 */
function summarizeSingleSide(
  content: string,
  type: ContentDiffLine['type'],
  previewLimit: number,
): ContentDiffSummary {
  let end = content.length
  if (end > 0 && content[end - 1] === '\n') {
    end -= 1
    if (end > 0 && content[end - 1] === '\r') end -= 1
  }
  if (end === 0) return { added: 0, removed: 0, preview: [], truncated: false }

  let lineStart = 0
  let count = 0
  const preview: ContentDiffLine[] = []
  for (let index = 0; index <= end; index += 1) {
    if (index !== end && content[index] !== '\n') continue
    let lineEnd = index
    if (lineEnd > lineStart && content[lineEnd - 1] === '\r') lineEnd -= 1
    count += 1
    if (preview.length < previewLimit) {
      const previewEnd = Math.min(lineEnd, lineStart + MAX_PREVIEW_LINE_CHARS + 1)
      preview.push({
        type,
        text: previewText(content.slice(lineStart, previewEnd)),
        lineNumber: count,
      })
    }
    lineStart = index + 1
  }

  return {
    added: type === 'added' ? count : 0,
    removed: type === 'removed' ? count : 0,
    preview,
    truncated: count > previewLimit,
  }
}

/**
 * 生成关闭确认所需的行级差异。常规文档使用 LCS 得到准确结果；
 * 超大改动退化为前后片段比较，避免关闭窗口时分配巨型矩阵。
 */
export function summarizeContentDiff(
  savedContent: string,
  currentContent: string,
  previewLimit = 14,
): ContentDiffSummary {
  if (savedContent === currentContent) {
    return { added: 0, removed: 0, preview: [], truncated: false }
  }
  if (!savedContent) return summarizeSingleSide(currentContent, 'added', previewLimit)
  if (!currentContent) return summarizeSingleSide(savedContent, 'removed', previewLimit)
  if (savedContent.length + currentContent.length > MAX_DETAILED_DIFF_CHARS) {
    const removedPreviewLimit = Math.ceil(previewLimit / 2)
    const removed = summarizeSingleSide(savedContent, 'removed', removedPreviewLimit)
    const added = summarizeSingleSide(
      currentContent,
      'added',
      Math.max(0, previewLimit - removedPreviewLimit),
    )
    return {
      added: added.added,
      removed: removed.removed,
      preview: [...removed.preview, ...added.preview],
      truncated: added.added + removed.removed > previewLimit,
    }
  }

  const before = linesOf(savedContent)
  const after = linesOf(currentContent)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldLines = before.slice(prefix, before.length - suffix)
  const newLines = after.slice(prefix, after.length - suffix)
  const preview: ContentDiffLine[] = []
  let added = 0
  let removed = 0
  const record = (type: ContentDiffLine['type'], text: string, lineNumber: number): void => {
    if (type === 'added') added += 1
    else removed += 1
    if (preview.length < previewLimit) preview.push({ type, text: previewText(text), lineNumber })
  }

  if (oldLines.length === 0) {
    added = newLines.length
    newLines.slice(0, previewLimit).forEach((text, index) => {
      preview.push({ type: 'added', text: previewText(text), lineNumber: prefix + index + 1 })
    })
  } else if (newLines.length === 0) {
    removed = oldLines.length
    oldLines.slice(0, previewLimit).forEach((text, index) => {
      preview.push({ type: 'removed', text: previewText(text), lineNumber: prefix + index + 1 })
    })
  } else if (oldLines.length * newLines.length <= MAX_MATRIX_CELLS) {
    const columns = newLines.length + 1
    const matrix = new Uint32Array((oldLines.length + 1) * columns)
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
        const offset = oldIndex * columns + newIndex
        matrix[offset] =
          oldLines[oldIndex] === newLines[newIndex]
            ? matrix[(oldIndex + 1) * columns + newIndex + 1] + 1
            : Math.max(matrix[(oldIndex + 1) * columns + newIndex], matrix[offset + 1])
      }
    }

    let oldIndex = 0
    let newIndex = 0
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        oldIndex += 1
        newIndex += 1
      } else if (
        newIndex < newLines.length &&
        (oldIndex === oldLines.length ||
          matrix[oldIndex * columns + newIndex + 1] > matrix[(oldIndex + 1) * columns + newIndex])
      ) {
        record('added', newLines[newIndex], prefix + newIndex + 1)
        newIndex += 1
      } else {
        record('removed', oldLines[oldIndex], prefix + oldIndex + 1)
        oldIndex += 1
      }
    }
  } else {
    removed = oldLines.length
    added = newLines.length
    for (let index = 0; index < oldLines.length && preview.length < previewLimit; index += 1) {
      preview.push({
        type: 'removed',
        text: previewText(oldLines[index]),
        lineNumber: prefix + index + 1,
      })
    }
    for (let index = 0; index < newLines.length && preview.length < previewLimit; index += 1) {
      preview.push({
        type: 'added',
        text: previewText(newLines[index]),
        lineNumber: prefix + index + 1,
      })
    }
  }

  return {
    added,
    removed,
    preview,
    truncated: added + removed > previewLimit,
  }
}
