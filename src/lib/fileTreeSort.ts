import type { FileNode, FileTreeSort } from '../types'

export interface SortContext {
  mode: FileTreeSort
  /** 置顶文件夹的绝对路径集合；同级里排在未置顶项之前。 */
  pinnedPaths: ReadonlySet<string>
  /** path → 最近打开排名（0 最近）。用于 'opened' 与 'smart'。 */
  recentRank: ReadonlyMap<string, number>
}

/** 由「最近打开」列表（最近在前）构建 path → 排名 的映射。 */
export function buildRecentRank(recentFiles: readonly string[]): Map<string, number> {
  const rank = new Map<string, number>()
  recentFiles.forEach((path, index) => {
    if (!rank.has(path)) rank.set(path, index)
  })
  return rank
}

function byNameAsc(a: FileNode, b: FileNode): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 「智能推荐」评分：越大越靠前。融合两路近期信号——
 *   - 最近打开：命中 recentRank 时给强权重（1.0），按排名线性衰减；
 *   - 最近修改：按 mtime 归一化后给中等权重（0.5）。
 * 两者都缺失（从没打开、mtime 为 0）自然落到 0，退回名称排序兜底。
 */
function smartScore(node: FileNode, ctx: SortContext, newest: number): number {
  const OPEN_WEIGHT = 1
  const MODIFIED_WEIGHT = 0.5
  const RECENT_WINDOW = 30

  let score = 0
  const rank = ctx.recentRank.get(node.path)
  if (rank !== undefined) {
    score += OPEN_WEIGHT * Math.max(0, (RECENT_WINDOW - rank) / RECENT_WINDOW)
  }
  if (newest > 0 && node.modifiedNanos > 0) {
    score += MODIFIED_WEIGHT * (node.modifiedNanos / newest)
  }
  return score
}

/**
 * 按选定模式排序单层节点。所有模式都保持「文件夹在前」，并把置顶文件夹提到最上；
 * 返回新数组，不修改入参。
 */
export function sortNodes(nodes: readonly FileNode[], ctx: SortContext): FileNode[] {
  const newest = nodes.reduce((max, n) => (n.modifiedNanos > max ? n.modifiedNanos : max), 0)

  const compare = (a: FileNode, b: FileNode): number => {
    // 文件夹始终排在文件之前，各模式只决定同类之间的次序。
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1

    switch (ctx.mode) {
      case 'nameDesc':
        return -byNameAsc(a, b)
      case 'modified': {
        if (a.modifiedNanos !== b.modifiedNanos) return b.modifiedNanos - a.modifiedNanos
        return byNameAsc(a, b)
      }
      case 'opened': {
        // 文件夹不参与「打开」记录，按名称排。
        if (!a.isDir) {
          const ra = ctx.recentRank.get(a.path)
          const rb = ctx.recentRank.get(b.path)
          if (ra !== undefined || rb !== undefined) {
            if (ra === undefined) return 1
            if (rb === undefined) return -1
            if (ra !== rb) return ra - rb
          }
        }
        return byNameAsc(a, b)
      }
      case 'smart': {
        const sa = smartScore(a, ctx, newest)
        const sb = smartScore(b, ctx, newest)
        if (sa !== sb) return sb - sa
        return byNameAsc(a, b)
      }
      case 'default':
      default:
        return byNameAsc(a, b)
    }
  }

  const pinned: FileNode[] = []
  const rest: FileNode[] = []
  for (const node of nodes) {
    if (ctx.pinnedPaths.has(node.path)) pinned.push(node)
    else rest.push(node)
  }
  pinned.sort(compare)
  rest.sort(compare)
  return [...pinned, ...rest]
}
