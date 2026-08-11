/**
 * 左栏在同一位置上轮流展示的三种视图。
 *
 * 以前这是 `searchView` 和 `tagNavigation.overviewOpen` 两个布尔量拼出来的，
 * 优先级只存在于 JSX 三元的书写顺序里，每加一个入口都要记得把另一个关掉
 * （`setSearchView(false)` 曾散落在四处）。收成一个枚举后互斥天然成立。
 *
 * 注意 `selectedTag`（中间结果列）是独立维度：它可以在任何模式下开着。
 */
export type SidebarMode = 'files' | 'search' | 'tags'
