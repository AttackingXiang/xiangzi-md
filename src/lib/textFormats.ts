/**
 * 文件树可见性白名单的「格式分组」定义。设置里按分组展示复选框，但存储层
 * （AppSettings.visibleTextExtensions 与 Rust 侧）只认扁平的扩展名列表，因此这里
 * 负责分组 ↔ 扩展名 的映射。Markdown 与无扩展名文件始终可见，不在此列。
 */
import { TEXT_FORMAT_GROUPS, type TextFormatGroup } from './fileCapabilities'

export { TEXT_FORMAT_GROUPS, type TextFormatGroup } from './fileCapabilities'

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
