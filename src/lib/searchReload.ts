/**
 * 判断「已打开文件的磁盘内容是否变过」，用于决定是否需要重跑文件夹搜索。
 *
 * 直接把整个标签页集合拼成一个 key 看似等价，其实不是：点开一条搜索结果就会
 * 新增一个标签页，key 随之变化，于是每点一次结果都要清空列表并重跑一次全量搜索。
 * 这里只认「以前见过的路径，哈希变了」——新出现的路径只登记不计数，因为打开
 * 一个文件并不改变它在磁盘上的内容。
 *
 * 会就地更新 `known`，调用方持有它跨渲染复用。
 */
export function recordContentChanges(
  known: Map<string, string>,
  openFiles: readonly { path: string | null; contentHash: string }[],
): boolean {
  let changed = false
  for (const file of openFiles) {
    if (!file.path) continue
    const previous = known.get(file.path)
    known.set(file.path, file.contentHash)
    if (previous !== undefined && previous !== file.contentHash) changed = true
  }
  return changed
}
