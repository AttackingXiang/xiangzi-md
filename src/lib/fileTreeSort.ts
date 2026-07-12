import type { FileNode, FileTreeSort } from '../types'
import { recencyBlend } from './recency'

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

/**
 * 参与排序的近期信号。文件用自身数据；文件夹没有「打开」概念，其信号由内部
 * 文件聚合而来（见 resolveSignal），从而与文件走同一套排序逻辑。
 */
interface NodeSignal {
  /** 最近打开排名（越小越近）；无记录为 undefined。文件夹取子孙文件里的最小值。 */
  rank: number | undefined
  /** 修改时间（Unix 纳秒）。文件夹取自身与子孙文件里的最大值。 */
  mtime: number
}

/** path 是否位于 dir 目录之内（任意层级）。兼容 '/' 与 '\\' 分隔符。 */
function isInsideDir(path: string, dir: string): boolean {
  if (!path.startsWith(dir)) return false
  const next = path.charCodeAt(dir.length)
  return next === 47 /* '/' */ || next === 92 /* '\\' */
}

/**
 * 计算单个节点的排序信号。文件夹「往里看」聚合内部文件——
 *   - rank：取内部文件里最小（最近）的最近打开排名；直接用全局 recentRank 做
 *     路径前缀匹配，因此不依赖文件树是否已懒加载出该文件夹的 children；全没打开则 undefined。
 *   - mtime：取文件夹自身 mtime 与已加载子孙文件 mtime 的最大值（自身作兜底下限）。
 *     受懒加载限制，未展开的文件夹只能拿到自身 mtime——与原「最近修改」行为一致，无回退。
 * 于是文件夹在 opened/modified/smart 三种模式下都按「内部最活跃的文件」排序。
 */
function resolveSignal(node: FileNode, recentRank: ReadonlyMap<string, number>): NodeSignal {
  if (!node.isDir) {
    return { rank: recentRank.get(node.path), mtime: node.modifiedNanos }
  }

  // rank：全局 recentRank（≤15 条）前缀匹配，无需 children 已加载。
  let rank: number | undefined
  for (const [path, r] of recentRank) {
    if (isInsideDir(path, node.path) && (rank === undefined || r < rank)) rank = r
  }

  // mtime：尽力遍历已加载的子孙文件，自身 mtime 作下限。
  let mtime = node.modifiedNanos
  const stack: FileNode[] = node.children ? [...node.children] : []
  while (stack.length > 0) {
    const child = stack.pop() as FileNode
    if (child.isDir) {
      if (child.children) stack.push(...child.children)
      continue
    }
    if (child.modifiedNanos > mtime) mtime = child.modifiedNanos
  }
  return { rank, mtime }
}

function byNameAsc(a: FileNode, b: FileNode): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 按选定模式排序单层节点。所有模式都保持「文件夹在前」，并把置顶文件夹提到最上；
 * 文件夹的近期排序信号来自其内部文件（见 resolveSignal），因此与文件共用同一逻辑。
 * 返回新数组，不修改入参。
 */
export function sortNodes(nodes: readonly FileNode[], ctx: SortContext): FileNode[] {
  const signals = new Map<string, NodeSignal>()
  for (const node of nodes) signals.set(node.path, resolveSignal(node, ctx.recentRank))
  let newest = 0
  for (const s of signals.values()) if (s.mtime > newest) newest = s.mtime

  const sig = (node: FileNode): NodeSignal => signals.get(node.path) as NodeSignal

  const compare = (a: FileNode, b: FileNode): number => {
    // 文件夹始终排在文件之前，各模式只决定同类之间的次序。
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1

    switch (ctx.mode) {
      case 'nameDesc':
        return -byNameAsc(a, b)
      case 'modified': {
        const ma = sig(a).mtime
        const mb = sig(b).mtime
        if (ma !== mb) return mb - ma
        return byNameAsc(a, b)
      }
      case 'opened': {
        const ra = sig(a).rank
        const rb = sig(b).rank
        if (ra !== undefined || rb !== undefined) {
          if (ra === undefined) return 1
          if (rb === undefined) return -1
          if (ra !== rb) return ra - rb
        }
        return byNameAsc(a, b)
      }
      case 'smart': {
        const sa = recencyBlend(sig(a).rank, sig(a).mtime, newest)
        const sb = recencyBlend(sig(b).rank, sig(b).mtime, newest)
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
