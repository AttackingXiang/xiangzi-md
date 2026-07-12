import type { RecentDoc } from '../types'

/**
 * 「最近活跃度」打分中枢——文件树与标签树的智能排序共用这一处权重与公式，避免复制漂移。
 *
 * 两层职责：
 *   1. buildFrecencyRank：把 recentDocs 语料按 frecency（频率 × 时间衰减 + 编辑近因 +
 *      当前打开加权）算成 path → 排名映射，喂给排序层的 recentRank。
 *   2. recencyBlend：排序层拿到某节点的 (rank, mtime) 后融合成最终分数——文件树按文件、
 *      标签树按标签子树聚合后都调它。
 */

const NANOS_PER_DAY = 24 * 60 * 60 * 1_000_000_000

// —— frecency 打分权重（buildFrecencyRank）——
/** 打开热度的时间半衰期：一周前的一次打开，权重折半。 */
const OPEN_HALF_LIFE_DAYS = 7
/** 编辑近因权重：编辑是比单纯打开更强的信号。 */
const EDIT_WEIGHT = 2
/** 编辑近因的时间半衰期。 */
const EDIT_HALF_LIFE_DAYS = 7
/** 当前已打开的 tab 的加成，量级远大于普通 frecency，确保工作集稳居前列。 */
const OPEN_TAB_BONUS = 1_000_000

// —— (rank, mtime) 融合权重（recencyBlend，排序层用）——
const OPEN_WEIGHT = 1
const MODIFIED_WEIGHT = 0.5
/** 只有排名进前 RECENT_WINDOW 名的才享有「最近打开」加权，之后交给 mtime。 */
const RECENT_WINDOW = 30

function halfLifeDecay(ageNanos: number, halfLifeDays: number): number {
  if (ageNanos <= 0) return 1
  return Math.pow(0.5, ageNanos / (halfLifeDays * NANOS_PER_DAY))
}

/** 单条记录的 frecency 分：打开热度按半衰期衰减 × 次数，叠加编辑近因，再叠当前打开加成。 */
function frecencyScore(doc: RecentDoc, now: number, isOpenTab: boolean): number {
  let score = doc.openCount * halfLifeDecay(now - doc.lastOpenedNanos, OPEN_HALF_LIFE_DAYS)
  if (doc.lastEditedNanos > 0) {
    score += EDIT_WEIGHT * halfLifeDecay(now - doc.lastEditedNanos, EDIT_HALF_LIFE_DAYS)
  }
  if (isOpenTab) score += OPEN_TAB_BONUS
  return score
}

/**
 * 由 frecency 语料构建 path → 排名（0 最靠前）。当前打开但尚未入库的 tab 也会被补入并置顶，
 * 保证工作集立刻可见。空语料返回空 Map，排序层自然退回名称/mtime 兜底。
 */
export function buildFrecencyRank(
  docs: readonly RecentDoc[],
  now: number,
  openTabPaths?: ReadonlySet<string>,
): Map<string, number> {
  const scored = new Map<string, number>()
  for (const doc of docs) {
    scored.set(doc.path, frecencyScore(doc, now, openTabPaths?.has(doc.path) ?? false))
  }
  // 已打开但还没被记录的文件（例如刚点开还没到停留阈值）：也给满额打开加成，别落榜。
  if (openTabPaths) {
    for (const path of openTabPaths) {
      if (!scored.has(path)) scored.set(path, OPEN_TAB_BONUS)
    }
  }

  const rank = new Map<string, number>()
  Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([path], index) => rank.set(path, index))
  return rank
}

/**
 * 把某节点的近期信号 (rank, mtime) 融合成排序分数——越大越靠前。
 *   - rank 命中且在窗口内：给强权重、按名次线性衰减；
 *   - mtime 按同级最新值归一化给中等权重。
 * 文件树按文件、标签树按标签子树聚合出 rank/mtime 后都调用它。
 */
export function recencyBlend(rank: number | undefined, mtime: number, newest: number): number {
  let score = 0
  if (rank !== undefined) {
    score += OPEN_WEIGHT * Math.max(0, (RECENT_WINDOW - rank) / RECENT_WINDOW)
  }
  if (newest > 0 && mtime > 0) {
    score += MODIFIED_WEIGHT * (mtime / newest)
  }
  return score
}
