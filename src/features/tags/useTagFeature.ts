import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo } from 'react'
import { desktop } from '../../platform'
import { t } from '../../lib/i18n'
import { baseName } from '../../lib/path'
import type { MenuItem } from '../../components/ContextMenu'
import type { Folder, Tab } from '../../types'
import type { AppSettings } from '../../platform/contracts'
import type { useFileOps } from '../../hooks/useFileOps'
import type { useTreeOps } from '../../hooks/useTreeOps'
import { useTagIndex } from './useTagIndex'
import { buildTagTree, isTagInSubtree } from './tagTree'
import { useTagNavigation } from './useTagNavigation'
import {
  documentMetaFromMarkdown,
  extractInlineTags,
  normalizeTag,
  parseMarkdownFrontmatter,
  tagKey,
} from './frontmatter'
import { moveTagUnderTarget, renameTagInMarkdown } from './renameTag'
import {
  parseFrontmatterProperties,
  setFrontmatterProperties,
  type DocumentProperty,
} from './properties'

type CtxMenuState = {
  x: number
  y: number
  items: MenuItem[]
  preserveSelection?: boolean
} | null

type InputDialogState = {
  title: string
  initial?: string
  confirmText?: string
  onSubmit: (value: string) => void
} | null

export interface UseTagFeatureDeps {
  activeTab: Tab | null
  folder: Folder | null
  settings: AppSettings | null
  /** useTreeOps 的 treeKey：文件树发生变化（新建/删除/移动/刷新）时驱动标签
   * 索引按 mtime 增量重扫。 */
  treeKey: number
  lang: 'zh' | 'en'
  stateRef: ReturnType<typeof useFileOps>['stateRef']
  updateContent: ReturnType<typeof useFileOps>['updateContent']
  markTabPersisted: ReturnType<typeof useFileOps>['markTabPersisted']
  saveTab: ReturnType<typeof useFileOps>['saveTab']
  pushUndo: ReturnType<typeof useTreeOps>['pushUndo']
  togglePinnedTag: (tagKey: string) => void
  setSidebarVisible: Dispatch<SetStateAction<boolean>>
  setSearchView: Dispatch<SetStateAction<boolean>>
  setInputDialog: Dispatch<SetStateAction<InputDialogState>>
  setCtxMenu: Dispatch<SetStateAction<CtxMenuState>>
}

/**
 * 把 App.tsx 里所有标签 / 文档属性相关的状态与命令收拢到一处：frontmatter 派生值
 * (activeFrontmatter/activeProperties/inlineOnlyTags/hasBodyHeading)、标签索引与
 * 派生树 (useTagIndex/useTagNavigation/relatedDocuments/tagTree)、保存后把最新内容
 * upsert 进索引的 effect，以及标签命令 (点击/改名/移动/右键菜单、属性面板改动)。
 *
 * 这些代码原先散落在 App.tsx 里，是这个上帝组件体积的主要来源之一；单独收拢成
 * hook 之后，App.tsx 只需要消费这里导出的值/回调，不用关心标签索引怎么增量扫描、
 * 标签树怎么按 "/" 分组、改名怎么同时处理已打开/未打开的文档等实现细节。拆分粒度
 * 与既有的 useTagIndex（增量扫描）、useTagNavigation（选中标签/总览开关这两个独立
 * 维度）保持一致，这里进一步把它们与 frontmatter 解析、树构建、改名命令组合起来，
 * 对外只暴露 App.tsx 实际会用到的那一层。
 *
 * 纯搬移：所有逻辑、依赖数组、注释均与原 App.tsx 保持一致，唯一差异是闭包变量
 * 换成了 deps 参数。
 */
export function useTagFeature(deps: UseTagFeatureDeps) {
  const {
    activeTab,
    folder,
    settings,
    treeKey,
    lang,
    stateRef,
    updateContent,
    markTabPersisted,
    saveTab,
    pushUndo,
    togglePinnedTag,
    setSidebarVisible,
    setSearchView,
    setInputDialog,
    setCtxMenu,
  } = deps

  const tagNavigation = useTagNavigation()

  const activeFrontmatter = useMemo(
    () => parseMarkdownFrontmatter(activeTab?.content ?? ''),
    [activeTab?.content],
  )
  // 顶部属性面板：解析出 frontmatter 的全部字段（title/tags/aliases/任意自定义键），
  // 逐行以 Obsidian 风格展示、可编辑。
  const activeProperties = useMemo(
    () => parseFrontmatterProperties(activeFrontmatter.raw),
    [activeFrontmatter.raw],
  )
  // Milkdown 每个事务都会把全文重新序列化写回 activeTab.content，导致
  // activeFrontmatter.body 每次击键都变。inlineOnlyTags / hasBodyHeading 只喂给
  // 属性面板和标题占位这两处纯展示逻辑，不参与任何写盘或命令判断，晚一拍渲染
  // 不影响正确性，所以对 body 用 useDeferredValue 延后计算，避免每键都做一次
  // 全文正则/代码剥离。
  const deferredBody = useDeferredValue(activeFrontmatter.body)
  // 正文里手打的 #标签（只读，展示在 tags 行末尾）——排除掉已经写进 frontmatter
  // tags 的，避免重复。
  const inlineOnlyTags = useMemo(() => {
    const seen = new Set(activeFrontmatter.tags.map(tagKey))
    return extractInlineTags(deferredBody).filter((tag) => !seen.has(tagKey(tag)))
  }, [activeFrontmatter.tags, deferredBody])
  // 有些笔记（尤其从别的工具迁移过来的）只在 frontmatter 写了 title，正文没有
  // H1——这种情况下正文没有任何东西看起来像"标题"，需要把 frontmatter 的
  // title 显示出来占上这个位置，而不是让笔记看起来像没有标题。
  const hasBodyHeading = useMemo(() => /^\s*#\s+(.+?)\s*$/m.test(deferredBody), [deferredBody])

  const tagIndex = useTagIndex(folder?.root ?? null, treeKey)
  // 选中某个标签时展示的相关文档：父标签聚合它自己 + 所有子标签（前缀 key/）
  // 的文档，去重——跟 Obsidian 一样，点父标签能看到整棵子树下的内容。
  const resultSort = settings?.tagResultSort ?? 'updated'
  const relatedDocuments = useMemo(() => {
    const key = tagNavigation.selectedTag
    if (!key) return []
    const seen = new Set<string>()
    const documents = Object.entries(tagIndex.tagIndex)
      .filter(([tag]) => isTagInSubtree(tag, key))
      .flatMap(([, docs]) => docs)
      .filter((document) => {
        if (seen.has(document.path)) return false
        seen.add(document.path)
        return true
      })
    return documents.sort(
      resultSort === 'name'
        ? (a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
            b.updatedAt - a.updatedAt
        : (a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title),
    )
  }, [tagNavigation.selectedTag, tagIndex.tagIndex, resultSort])

  // 标签总览：按 "/" 构建 Obsidian 式嵌套分组树（见 tagTree.ts）。
  const groupsFirst = settings?.tagGroupsFirst ?? false
  const tagTree = useMemo(
    () =>
      buildTagTree(
        Object.entries(tagIndex.tagIndex).map(([key, documents]) => ({
          key,
          label: tagIndex.tagLabels[key] ?? key,
          docPaths: documents.map((document) => document.path),
        })),
        { groupsFirst },
      ),
    [tagIndex.tagIndex, tagIndex.tagLabels, groupsFirst],
  )

  useEffect(() => {
    tagNavigation.reset()
  }, [folder?.root, tagNavigation.reset])

  useEffect(() => {
    if (!activeTab?.path || !activeTab.version) return
    // 文档不属于当前打开的工作区（比如通过"打开文件"单独打开了外部文件）时不要
    // 把它并入标签索引——否则切换回这个文件夹后，标签总览/相关文档里会混入
    // 不属于这个工作区的文档。判定逻辑与 revealActiveFile 里的 isUnderFolder
    // 保持一致。
    const root = folder?.root
    const isUnderFolder =
      !root || activeTab.path.startsWith(root + '/') || activeTab.path.startsWith(root + '\\')
    if (!isUnderFolder) return
    tagIndex.upsertDocument(
      documentMetaFromMarkdown(
        activeTab.path,
        activeTab.name,
        activeTab.savedContent,
        activeTab.version.modifiedNanos,
      ),
      activeTab.version.modifiedNanos,
    )
  }, [
    activeTab?.name,
    activeTab?.path,
    activeTab?.savedContent,
    activeTab?.version,
    folder?.root,
    tagIndex.upsertDocument,
  ])

  // 点正文里的标签：默认隐藏文件树，只留下中间结果列；开了「点击标签时展开全部
  // 标签」才在左侧展示标签树。标签树自身的点击走 openTreeTag，始终保留标签树。
  const openDocumentTag = useCallback(
    (tag: string): void => {
      setSearchView(false)
      // 已经手动打开的标签树属于用户当前工作状态，切换文档内的标签时保留它；
      // 只有左侧仍是文件树且设置关闭时，才收起左栏、只展示结果列。
      const openOverview = tagNavigation.overviewOpen || (settings?.tagClickOpensOverview ?? false)
      setSidebarVisible(openOverview)
      tagNavigation.openTag(tag, openOverview)
    },
    [
      setSearchView,
      setSidebarVisible,
      tagNavigation.openTag,
      tagNavigation.overviewOpen,
      settings?.tagClickOpensOverview,
    ],
  )

  const openTreeTag = useCallback(
    (tag: string): void => {
      setSearchView(false)
      setSidebarVisible(true)
      tagNavigation.openTag(tag, true)
    },
    [setSearchView, setSidebarVisible, tagNavigation.openTag],
  )

  const showAllTags = useCallback((): void => {
    setSidebarVisible(true)
    setSearchView(false)
    tagNavigation.showOverview()
  }, [tagNavigation.showOverview])

  /** 标签改名/移动统一入口：把 fromKey（连同整棵子树）改写成 toTag 前缀。
   * scope='active' 只改当前文档；'all' 改所有含此标签的文档（改盘前弹确认）。
   * 打开着的标签页走内存更新 + saveTab，未打开的直接 readFile→改写→writeFile。 */
  const applyTagRename = useCallback(
    async (fromKey: string, rawNewTag: string, scope: 'all' | 'active'): Promise<void> => {
      const toTag = normalizeTag(rawNewTag)
      if (!toTag || tagKey(toTag) === fromKey) return

      // 每改完一篇就把它的新 meta 直接并入标签索引（而不是事后整仓重扫）——重扫是
      // 异步的，容易和刚写的盘抢跑、把旧数据又读回来，导致左侧标签树“没生效”。直接
      // upsert 用的是我们手上确定的新内容，即时、精确，也更省。
      const applyToOpenTab = async (
        tab: (typeof stateRef.current.tabs)[number],
      ): Promise<boolean> => {
        const { changed, content } = renameTagInMarkdown(tab.content, fromKey, toTag)
        if (!changed) return false
        if (!tab.path) {
          // 未保存的新文档：只更新内存缓冲，等用户真正保存时一起落盘。
          updateContent(tab.id, content)
          return true
        }
        // 已有磁盘文件：直接强制写盘，再把结果并回标签页（置为已保存）。不经过
        // updateContent + saveTab 的往返——批量改多篇时那条路径依赖 stateRef 同步，
        // 会让后续标签页停留在“待保存”。
        const result = await desktop.writeFile(tab.path, content, null, true)
        markTabPersisted(tab.id, content, result.version)
        tagIndex.upsertDocument(
          documentMetaFromMarkdown(tab.path, tab.name, content, result.version.modifiedNanos),
          result.version.modifiedNanos,
        )
        return true
      }

      if (scope === 'active') {
        const tab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId)
        if (tab) await applyToOpenTab(tab)
        return
      }

      const paths = new Set<string>()
      for (const [key, documents] of Object.entries(tagIndex.tagIndex)) {
        if (!isTagInSubtree(key, fromKey)) continue
        for (const document of documents) paths.add(document.path)
      }
      if (paths.size === 0) return
      const message =
        lang === 'en'
          ? `Rewrite this tag in ${paths.size} document(s)?`
          : `将修改 ${paths.size} 个文档里的这个标签，确定？`
      if (!window.confirm(message)) return

      const openByPath = new Map<string, (typeof stateRef.current.tabs)[number]>()
      for (const tab of stateRef.current.tabs) if (tab.path) openByPath.set(tab.path, tab)

      let changed = 0
      let failed = 0
      for (const path of paths) {
        try {
          const tab = openByPath.get(path)
          if (tab) {
            if (await applyToOpenTab(tab)) changed += 1
          } else {
            // 未打开的文件：读 → 改 → 强制写盘（跳过版本冲突检查——写的正是刚读的内容）。
            const file = await desktop.readFile(path)
            const result = renameTagInMarkdown(file.content, fromKey, toTag)
            if (result.changed) {
              // 用写盘后返回的 version（而非写盘前读到的 file.version），这样"最近
              // 更新"排序准确，且增量扫描缓存里记的 mtime 与磁盘一致，不会白白把刚
              // 改过的文件当成"外部又变了"再重读一遍。
              const written = await desktop.writeFile(path, result.content, null, true)
              tagIndex.upsertDocument(
                documentMetaFromMarkdown(
                  path,
                  baseName(path),
                  result.content,
                  written.version.modifiedNanos,
                ),
                written.version.modifiedNanos,
              )
              changed += 1
            }
          }
        } catch {
          failed += 1
        }
      }

      void desktop.notify(
        lang === 'en'
          ? `Updated ${changed} document(s)${failed ? `, ${failed} failed` : ''}.`
          : `已更新 ${changed} 个文档${failed ? `，${failed} 个失败` : ''}。`,
      )
    },
    [tagIndex, updateContent, markTabPersisted, stateRef, lang],
  )

  const promptRenameTag = useCallback(
    (fromKey: string, currentLabel: string, scope: 'all' | 'active'): void => {
      setInputDialog({
        title: scope === 'active' ? t('在本文档重命名标签') : t('重命名 / 修改分组（用 / 分层）'),
        initial: currentLabel,
        confirmText: t('确定'),
        onSubmit: (value) => void applyTagRename(fromKey, value, scope),
      })
    },
    [applyTagRename],
  )

  const moveTagUnder = useCallback(
    (dragKey: string, targetFullLabel: string): void => {
      void applyTagRename(dragKey, moveTagUnderTarget(dragKey, targetFullLabel), 'all')
    },
    [applyTagRename],
  )

  const openTagContext = useCallback(
    (key: string, fullLabel: string, x: number, y: number): void => {
      const pinned = (settings?.pinnedTags ?? []).includes(key)
      setCtxMenu({
        x,
        y,
        items: [
          { label: pinned ? t('取消置顶') : t('置顶'), onClick: () => togglePinnedTag(key) },
          { label: t('重命名 / 修改分组'), onClick: () => promptRenameTag(key, fullLabel, 'all') },
        ],
      })
    },
    [promptRenameTag, setCtxMenu, settings?.pinnedTags, togglePinnedTag],
  )

  // 文档里右键某个标签 chip：既能全局改，也能只改本文档（默认全改）。
  const openDocTagContext = useCallback(
    (tag: string, x: number, y: number): void => {
      const key = tagKey(tag)
      setCtxMenu({
        x,
        y,
        items: [
          { label: t('重命名 / 修改分组'), onClick: () => promptRenameTag(key, tag, 'all') },
          { label: t('仅在本文档修改'), onClick: () => promptRenameTag(key, tag, 'active') },
        ],
      })
    },
    [promptRenameTag],
  )

  /** 属性面板改动统一入口：用新的属性列表重写 frontmatter、写回 content、存盘。
   * 标签索引的更新交给上面那个 effect（它已经在监听 activeTab.savedContent/version），
   * 不在这里手动调用 upsertDocument，避免维护两份触发路径。写入方式必须走
   * updateContent（更新 tab.content 且同步刷新 stateRef）再调用 saveTab，
   * 不能让 performSave 携带独立的内容快照——那样在保存排队被合并/覆盖时，
   * 改动会悄悄丢失但调用方仍然收到"保存成功"。
   * 未保存（无 path）的新文档也允许改属性：只更新内存缓冲，等用户真正保存时
   * 一起落盘，不弹另存为对话框。每次改动都往撤销栈压一步，支持 Cmd+Z / 侧边栏
   * 撤销按钮把属性恢复到改动前。 */
  const changeDocumentProperties = useCallback(
    async (next: DocumentProperty[]): Promise<boolean> => {
      const current = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
      if (!current) return false
      const nextContent = setFrontmatterProperties(current.content, next)
      if (nextContent === current.content) return true
      const tabId = current.id
      const previousContent = current.content
      pushUndo({
        type: 'restore',
        run: async () => {
          updateContent(tabId, previousContent)
          if (stateRef.current.tabs.find((tab) => tab.id === tabId)?.path) await saveTab(tabId)
        },
      })
      updateContent(tabId, nextContent)
      if (!current.path) return true
      return saveTab(tabId)
    },
    [pushUndo, saveTab, stateRef, updateContent],
  )

  return {
    tagIndex,
    tagNavigation,
    tagTree,
    relatedDocuments,
    activeFrontmatter,
    activeProperties,
    inlineOnlyTags,
    hasBodyHeading,
    openDocumentTag,
    openTreeTag,
    showAllTags,
    openTagContext,
    openDocTagContext,
    moveTagUnder,
    changeDocumentProperties,
  }
}
