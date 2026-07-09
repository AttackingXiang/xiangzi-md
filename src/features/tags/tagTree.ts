/** Obsidian 风格的嵌套标签分组：标签按 "/" 拆成层级，a/b、a/c 归到 a 下面。
 * 纯函数，方便测试；渲染层（TagOverviewSidebar）只负责展开/折叠和点击。 */
export interface TagTreeNode {
  /** 完整标签 key（如 project/work），用于导航与展开状态。 */
  key: string
  /** 该层显示的片段（如 work），尽量保留原始大小写。 */
  segment: string
  /** 完整标签展示名（如 Project/Work），点击导航/悬浮提示用。 */
  fullLabel: string
  /** 打了这个「精确」标签的文档数（分组占位节点为 0）。 */
  selfCount: number
  /** 本子树内去重后的文档总数（含所有后代标签）。 */
  totalCount: number
  children: TagTreeNode[]
}

export interface TagTreeEntry {
  key: string
  label: string
  docPaths: readonly string[]
}

interface BuildNode {
  key: string
  segment: string
  selfDocs: Set<string>
  subtreeDocs: Set<string>
  children: Map<string, BuildNode>
}

export interface BuildTagTreeOptions {
  /** 把「含子标签的分组」排在同级前面（默认按文档数排序）。 */
  groupsFirst?: boolean
}

function toTreeNodes(
  nodes: Map<string, BuildNode>,
  parentLabel: string,
  options: BuildTagTreeOptions,
): TagTreeNode[] {
  return Array.from(nodes.values())
    .map((node): TagTreeNode => {
      const fullLabel = parentLabel ? `${parentLabel}/${node.segment}` : node.segment
      return {
        key: node.key,
        segment: node.segment,
        fullLabel,
        selfCount: node.selfDocs.size,
        totalCount: node.subtreeDocs.size,
        children: toTreeNodes(node.children, fullLabel, options),
      }
    })
    .sort((a, b) => {
      if (options.groupsFirst) {
        const groupDelta = Number(b.children.length > 0) - Number(a.children.length > 0)
        if (groupDelta !== 0) return groupDelta
      }
      return (
        b.totalCount - a.totalCount ||
        a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' })
      )
    })
}

/** 把扁平的标签条目构建成嵌套树。分组占位节点（没有文档直接打它、只因为有后代
 * 才存在）selfCount 为 0；每个节点的 totalCount 是其子树内去重后的文档数。 */
export function buildTagTree(
  entries: readonly TagTreeEntry[],
  options: BuildTagTreeOptions = {},
): TagTreeNode[] {
  const roots = new Map<string, BuildNode>()
  for (const entry of entries) {
    const keySegments = entry.key.split('/').filter(Boolean)
    if (keySegments.length === 0) continue
    const labelSegments = entry.label.split('/')
    let level = roots
    let keyPath = ''
    let leaf: BuildNode | undefined
    keySegments.forEach((keySeg, i) => {
      keyPath = keyPath ? `${keyPath}/${keySeg}` : keySeg
      let node = level.get(keySeg)
      if (!node) {
        node = {
          key: keyPath,
          // 首个提供该层的条目决定显示大小写；分组占位节点也能借后代拿到原样片段。
          segment: labelSegments[i]?.trim() || keySeg,
          selfDocs: new Set(),
          subtreeDocs: new Set(),
          children: new Map(),
        }
        level.set(keySeg, node)
      }
      for (const path of entry.docPaths) node.subtreeDocs.add(path)
      leaf = node
      level = node.children
    })
    if (leaf) for (const path of entry.docPaths) leaf.selfDocs.add(path)
  }
  return toTreeNodes(roots, '', options)
}

/** 默认展开层级用：返回深度 ≥ depth 的所有「分组节点」（有子节点）的 key，作为
 * 需要折叠的集合。depth < 0 表示全部展开（返回空）。深度从 0（顶层）开始。 */
export function groupKeysToCollapse(nodes: readonly TagTreeNode[], depth: number): string[] {
  if (depth < 0) return []
  const keys: string[] = []
  const walk = (list: readonly TagTreeNode[], current: number): void => {
    for (const node of list) {
      if (node.children.length === 0) continue
      if (current >= depth) keys.push(node.key)
      walk(node.children, current + 1)
    }
  }
  walk(nodes, 0)
  return keys
}

/** 某个标签 key 是否落在 root 这棵子树内——即等于 root 本身，或以 root/ 开头。
 * 用来实现「点父标签能看到它 + 所有子标签的文档」（前缀匹配，不误伤 rootx）。 */
export function isTagInSubtree(tag: string, root: string): boolean {
  return tag === root || tag.startsWith(`${root}/`)
}

/** 树里的节点总数（含分组占位节点），供“共 N 个标签”之类的统计。 */
export function countTagTreeNodes(nodes: readonly TagTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTagTreeNodes(node.children), 0)
}

/** 把整棵树按 key 摊平成映射，方便按置顶的 key 反查出节点（拿到显示名和计数）。 */
export function flattenTagTree(nodes: readonly TagTreeNode[]): Map<string, TagTreeNode> {
  const map = new Map<string, TagTreeNode>()
  const walk = (list: readonly TagTreeNode[]): void => {
    for (const node of list) {
      map.set(node.key, node)
      walk(node.children)
    }
  }
  walk(nodes)
  return map
}
