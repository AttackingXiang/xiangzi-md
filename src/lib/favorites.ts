/**
 * 收藏顺序的纯逻辑。展示顺序就是 `settings.favorites` 数组的顺序，拖拽即改写它。
 *
 * 单独抽出来是因为下标运算容易写错（把一项往后拖时，删除它会让目标下标前移一位），
 * 而这段逻辑本身不需要 DOM 就能测。
 */
export function reorderFavoritePaths(
  order: readonly string[],
  dragPath: string,
  targetPath: string,
): string[] {
  if (dragPath === targetPath) return [...order]
  const from = order.indexOf(dragPath)
  const to = order.indexOf(targetPath)
  if (from < 0 || to < 0) return [...order]
  const next = [...order]
  next.splice(from, 1)
  // 目标在被拖项之后时，上面这次删除已经把它前移了一位，直接用 to 就等于"插在它前面"
  // 之后再落到它后面；两种方向都用"删完再按新数组里的目标位置插"来算。
  next.splice(next.indexOf(targetPath) + (from < to ? 1 : 0), 0, dragPath)
  return next
}
