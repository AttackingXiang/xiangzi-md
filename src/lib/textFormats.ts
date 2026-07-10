/**
 * 文件树可见性白名单的「格式分组」定义。设置里按分组展示复选框，但存储层
 * （AppSettings.visibleTextExtensions 与 Rust 侧）只认扁平的扩展名列表，因此这里
 * 负责分组 ↔ 扩展名 的映射。Markdown 与无扩展名文件始终可见，不在此列。
 */
export interface TextFormatGroup {
  id: string
  /** 中文标签 */
  label: string
  /** 英文标签 */
  labelEn: string
  /** 该分组包含的扩展名（小写、不含点） */
  extensions: string[]
}

export const TEXT_FORMAT_GROUPS: TextFormatGroup[] = [
  { id: 'plaintext', label: '纯文本', labelEn: 'Plain text', extensions: ['txt', 'log'] },
  { id: 'json', label: 'JSON', labelEn: 'JSON', extensions: ['json', 'json5', 'jsonc'] },
  { id: 'yaml', label: 'YAML', labelEn: 'YAML', extensions: ['yaml', 'yml'] },
  { id: 'toml', label: 'TOML', labelEn: 'TOML', extensions: ['toml'] },
  {
    id: 'ini',
    label: 'INI / Conf',
    labelEn: 'INI / Conf',
    extensions: ['ini', 'conf', 'properties'],
  },
  { id: 'xml', label: 'XML / SVG', labelEn: 'XML / SVG', extensions: ['xml', 'svg'] },
  { id: 'html', label: 'HTML', labelEn: 'HTML', extensions: ['html', 'htm'] },
  { id: 'css', label: 'CSS', labelEn: 'CSS', extensions: ['css'] },
  {
    id: 'javascript',
    label: 'JavaScript',
    labelEn: 'JavaScript',
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    labelEn: 'TypeScript',
    extensions: ['ts', 'mts', 'cts', 'tsx'],
  },
  { id: 'sql', label: 'SQL', labelEn: 'SQL', extensions: ['sql'] },
  { id: 'shell', label: 'Shell', labelEn: 'Shell', extensions: ['sh', 'bash', 'zsh'] },
]

/** 分组是否处于「勾选」状态：其全部扩展名都在白名单里才算勾选。 */
export function isGroupEnabled(group: TextFormatGroup, enabled: readonly string[]): boolean {
  const set = new Set(enabled)
  return group.extensions.every((ext) => set.has(ext))
}

/** 勾选/取消分组后，返回新的扩展名白名单（保持稳定顺序，去重）。 */
export function toggleGroup(
  group: TextFormatGroup,
  enabled: readonly string[],
  next: boolean,
): string[] {
  const set = new Set(enabled)
  for (const ext of group.extensions) {
    if (next) set.add(ext)
    else set.delete(ext)
  }
  // 按 TEXT_FORMAT_GROUPS 的声明顺序输出，避免存储值抖动。
  return TEXT_FORMAT_GROUPS.flatMap((g) => g.extensions).filter((ext) => set.has(ext))
}
