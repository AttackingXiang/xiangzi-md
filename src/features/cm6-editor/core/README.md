# CM6 WYSIWYG 核心引擎（Phase 1）

`core/` 是与具体 Markdown 语法特性解耦、可被 `livePreview.ts` 之外的其它 feature 模块复用的
"揭示/隐藏/边界命令" 引擎。它本身不知道任何具体渲染细节（列表符号长什么样、标题字号多大），
只负责三件事：**一个节点该不该显示源码**、**当前哪些范围因为选区而显示了源码**、以及
**在这个模型下，Backspace/Delete/Enter 应该做什么**。

## 模块

- `nodePolicy.ts` —策略表：给每个 Lezer 节点名一个 `RevealPolicyKind`。
- `revealState.ts` — `computeRevealedRanges`(纯函数) + `revealState`(StateField)：选区当前
  "揭示" 了哪些 `reveal-on-selection` 节点。
- `hiddenRanges.ts` — `hiddenRangeSource`(Facet) + `hiddenRangesEngine()`：把所有 feature
  注册的隐藏范围聚合成**唯一一个** `EditorView.atomicRanges` provider 和一份"不可见"
  decoration 集合。
- `boundaryCommands.ts` — 最小边界命令集：标题/列表/引用行首 Backspace、块拆分/合并、
  Enter/Shift-Enter、"删空即清除"。
- `types.ts` — `PreviewRange`/`mergeRanges`/`rangesTouch`/`expandedVisibleRanges` 等与
  Markdown 无关的纯几何工具。

## 策略语义（`RevealPolicyKind`）

- **`reveal-on-selection`**（行内标记，如 `**`/`*`/`~~`/`` ` ``/链接方括号与目标）：
  折叠光标位于节点范围内时，其标记字符正常显示、可编辑；非空选区保持渲染形态，避免拖选时
  因标记显隐引起换行和选区层抖动。光标离开后标记重新隐藏且保持原子。
- **`always-hidden`**（标题 `#`/Setext 下划线、HR 源文本、链接引用定义整行）：
  无论选区在哪，源码永远不显示，且必须是原子的。标题这一类**绝不能吞掉点击**——点击
  标题文字任意位置，光标必须落在被点击的字符上，而不是跳到行首（见
  `livePreview.ts` 里的 `linePositionAtPointer`）。
- **`widget`**（列表 bullet/序号、任务复选框、引用 `>`、callout 标签）：源码标记同样
  永不显示、永远原子，区别只是"用什么覆盖它"——不是空白替换，而是一个有样式/可交互的
  widget（复选框可点击切换、bullet 显示为 `•`、引用显示为行内 padding + 背景条）。
- **`atomic-block`**：整节点级的跨行隐藏，`reveal-on-selection`/`always-hidden`/`widget`
  都要求隐藏范围不跨越换行符（不变式 2），`atomic-block` 是唯一的例外。Phase 2 起
  `FencedCode`（代码块围栏，开/闭两行）注册为这一策略——`codeBlockPreview.ts` 通过
  `hiddenRangeSource` 把每条围栏行（含其后的换行符）登记为 `paint: false` 的隐藏范围：
  该范围仍然是"原子"的（无法把光标停在围栏文字与换行符之间），但视觉绘制留给
  `codeBlockPreview.ts` 自己的 `viewportDecorationExtension` StateField（跨行 replace
  只能从 StateField 安全提供，见 `hiddenRanges.ts` 里 `HiddenRange.paint` 的说明）。
  Phase 3 起表格（`Table`）、图片（`Image`）、数学块、Mermaid 图表也都以同样的
  `paint: false` 方式接入，见下面的 "Phase 3" 一节。缩进代码块（`CodeBlock`）目前不
  隐藏任何源码字符（live preview 未渲染成卡片），因此未注册。

## 不变式

1. **每一行都是文档里真实存在、可点击、可用方向键到达的一行**，包括空行。不存在
   "结构性" vs "显式" 空行的区分——这条区分（以及它背后的 `editableBlankParagraph`
   状态机和 `visualGapEdit` 点击补偿）在本阶段被整体删除。
2. **任何隐藏范围都不跨越换行符**（`atomic-block` 例外，但 Phase 1 未注册任何
   `atomic-block`）。需要隐藏一整个"结构性"物理行（如 Setext 下划线、链接引用定义）时，
   必须按行拆分成多个 `Decoration.replace`，见 `livePreview.ts` 的 `perLineRanges`。
3. **全局只有一个 `EditorView.atomicRanges` provider**（`hiddenRangesEngine()` 提供的
   那个），所有 Phase 1 迁移范围内的隐藏/原子范围都通过 `hiddenRangeSource` Facet 注册进
   来，不再有第二个 ViewPlugin 各自声明 atomicRanges。
4. **块间距用 line decoration 的 CSS padding 实现，不用行间 margin**——避免
   `posAtCoords` 落进没有归属行的空白区域。原来 `xmd-cm-block-separator`
   （`height: 0` 折叠空行）的技巧已删除；一行要么是真实高度的空行，要么其内容被
   同一行内的 `Decoration.replace` 隐藏（因此视觉上仍然是"看起来空白但可寻址"的一行）。
5. 自定义的 `moveVertically` keymap 已删除。一旦不再有零高度行，CM6 原生的
   `moveVertically`（依赖可视行几何）就能正确工作，不需要再手动跳过"分隔行"。

## 为什么删除了 `editableBlankParagraph` / `visualGapEdit` / `explicitBlankParagraphDeletion`

这三者的存在只是为了在"单个空行在两个块之间会被折叠成零高度、不可寻址"的旧模型下打补丁：

- `editableBlankParagraph` 用状态字段临时把一个刚创建的空行标记为"可编辑段落"，防止它被
  当作结构性分隔符立刻折叠掉。
- `visualGapEdit` 把点击"折叠行"周围的空白区域重新映射回最近的可编辑空行。
- `explicitBlankParagraphDeletion` 给"显式"空行一个整体删除的快捷路径，因为普通
  Backspace/Delete 在原子/折叠行边界上的默认行为并不正确。

新模型下空行不再折叠、不再原子化，三者要解决的问题也就不存在了：CM6 默认的
Backspace/Delete 已经能正确处理"删除一个真实的空行"。

## Phase 2：`codeBlockPreview.ts`（已完成）

`codeBlockPreview.ts`（代码块围栏）已收编进本引擎，不再维护独立的
`EditorView.atomicRanges`：

- `collectFencedCodeHiddenRanges` 通过 `hiddenRangeSource` 登记两条围栏行（开/闭
  ` ``` `，各自含其后的换行符）为 `paint: false` 的 `atomic-block` 范围（Mermaid 语言
  的围栏排除在外，仍由 `mermaidPreview.ts` 单独处理，见下面的已知缺口）。视觉绘制继续由
  `codeBlockPreview.ts` 自己的 `viewportDecorationExtension` StateField 承担——这正是
  `HiddenRange.paint: false` 存在的原因：core 的 ViewPlugin 聚合器只能安全承载不跨行的
  paint 范围，跨行（含换行符）的 replace 必须留在 StateField。
- Backspace/Delete 在块内的边界行为改为 `fencedCodeBoundaryDeletion(state, forward)`
  ——与 `core/boundaryCommands.ts` 同样的纯函数、返回 `TransactionSpec | null` 风格：
  Delete 在空白最后一行行首吞键（返回 `{}`）防止吃掉紧邻隐藏闭围栏前的边界；Backspace
  在**唯一**的空白 body 行行首时不再只是"保护"（旧版 `protectsEmptyFencedCodeBodyDeletion`
  的语义），而是一次事务删除整个块（含两条围栏），避免出现"先删掉闭围栏、相邻块解析
  合并"的中间态。
- `restoreEmptyFencedCodeBody` / `partiallyDeletesFencedCodeFence` 的意图不变，但改为
  `codeBlockPreview.ts` 自己的 `EditorState.transactionFilter`（不再由 `livePreview.ts`
  导入拼装）；现在光标驱动的选区不可能再落在围栏文字中间（原子范围保证），这两个函数的
  职责收窄为"非光标路径"（粘贴/撤销重做/外部文档同步）的兜底防线。
- 新增 `fencedCodeSelectAll`（Cmd/Ctrl+A 只选中代码内容，不含围栏，`Prec.high` keymap，
  光标不在代码块内时放行默认全选）与 `fencedCodeFenceRedirectTarget`（点击围栏行——
  `.xmd-cm-code-fence-line`，零高度、不该承载真实点击——重定向进入块内首/尾代码行；
  `livePreviewEvents.ts` 的通用"空行点击补偿"分支相应排除了这个 class，让
  `codeBlockPreview.ts` 自己的 `pointerdown` 处理器接手）。
- 上下方向键逐行移动、块边界进入相邻正文首/尾行不跳行，都不再需要模块自己的按键逻辑：
  两个 atomicRanges 来源合并成一个之后，CM6 原生的 `moveVertically` 已经足够（同 Phase 1
  不变式 5）。这部分行为需要真实 `EditorView` + 布局几何才能断言，本阶段仍未补充集成
  测试，见下面的已知缺口。
- 代码块内的光标绘制现在也和选区高亮一样切到浏览器原生：`caretInsideFencedCode`
  在光标为空选区且落在某个可编辑（非 Mermaid）代码 body 内时，给 `view.dom` 加
  `xmd-cm-native-code-caret` class（`CodeBlockScrollPlugin.updateSelectionPresentation`，
  与 `xmd-cm-native-code-selection` 同一处），CSS（codeBlockPreview.css）据此隐藏
  CM6 `drawSelection` 画的 `.cm-cursor-primary`、并解除该行内容元素上被
  `drawSelection` 设为 transparent 的 `caret-color`。此前用一个 transform 补偿
  hack（`CodeBlockScrollPlugin` 的 measure read/write 阶段计算/应用
  `cursorTranslateX`）纠正假光标位置，已整体删除——原生 caret 天然被嵌套横向
  滚动容器裁剪/跟随，不需要补偿，也不再有"每次按键闪一帧"“失焦重聚焦补偿静默
  失效”这类该 hack 特有的缺陷。`revealScrollLeft`（把嵌套滚动容器滚到光标可见位置）
  不受影响，继续保留：原生 caret 只解决"画在哪"，不解决"滚动容器要不要跟着光标走"。

## Phase 2 视觉打磨（已完成）

段落首尾 padding（`xmd-cm-paragraph-first`/`xmd-cm-paragraph-last`）现在区分"边缘是否
紧邻一条真实空行"：紧邻空行时用 `xmd-cm-paragraph-gap-before`/`-gap-after` 把 padding
降到一个小节奏值（原空行已经提供整行高度的间距，不需要再叠加满额 padding）；没有相邻空行
的边缘（例如段落被标题/列表/HR 直接打断、或位于文档首尾）保留满额 padding 以维持呼吸感。
单回车（两个块之间恰好一条空行）与双回车（两条空行）因此有一致的视觉区分度。代码块的
`.xmd-cm-code-fence-line` 本身高度为 0、不贡献 padding，不存在同样的叠加问题，
`codeBlockPreview.css` 未改动。

## Phase 3：表格/图片/数学/Mermaid 收编（已完成）

`tablePreview.ts`（`Table`）、`imagePreview.ts`（`Image`）、`mathPreview.ts`（手动扫描
的 `$...$`/`$$...$$`，无专属节点）、`mermaidPreview.ts`（`FencedCode` 的 Mermaid 语言
特例）不再各自维护独立的 `EditorView.atomicRanges`：

- 四个模块都新增了一个 `collect*HiddenRanges(state, visibleRanges, options)` 纯函数
  （`collectTableHiddenRanges`/`collectImageHiddenRanges`/`collectMathHiddenRanges`/
  `collectMermaidHiddenRanges`），通过 `hiddenRangeSource.of(...)` 注册进本引擎，范围
  与各自现有的 widget 替换 decoration 完全重合、`paint: false`——视觉绘制继续由各模块
  自己的 StateField/ViewPlugin 承担，做法与 Phase 2 的 `collectFencedCodeHiddenRanges`
  一致。`imagePreview.ts` 原先直接从自己的 ViewPlugin `provide: EditorView.atomicRanges`；
  `mathPreview.ts` 原先给 `viewportDecorationExtension` 传 `atomic: true`；两者都已删除，
  `viewportDecorations.ts` 的 `atomic` 选项也随最后一个使用者一起移除（该模块从此只
  提供 decoration，结构上不可能再出现第二个 atomicRanges 来源）。`tablePreview.ts`
  之前完全没有注册任何 atomic 范围。`core/nodePolicy.ts` 的 `ATOMIC_BLOCK_NAMES` 加入了
  `Table`/`Image`（数学与 Mermaid 不是按 Lezer 节点名发现的，不适用这张按节点名分类的
  表，`FencedCode` 已经覆盖了 Mermaid 围栏本身）。
- **修复了 Phase 2 发现的缺口**：`mermaidPreview.ts` 此前完全没有声明任何 atomic
  range，渲染态的 Mermaid 图表在光标遍历/点击/拖拽时会被 CM6 当作普通可选中源码——现在
  和其它三个模块一样经 `hiddenRangeSource` 收编，`math-mermaid.test.ts` 新增了直接覆盖
  这条修复的用例（含"与 `codeBlockPreview` 的 Mermaid 排除逻辑互补、不双重注册"的
  断言）。
- `tablePreview.ts` 的单元格交互修复。背景事实（读 CM6 源码确认）：`TableWidget.
ignoreEvent()` 返回 true，CM6 的输入分发（`eventBelongsToEditor`）会**忽略**一切
  发源于 widget 内部的事件，所以 CM6 自己的 keymap/鼠标选区逻辑从来看不到单元格里的
  按键与点击；真正的暴露面是（a）CM6 分发体系**之外**的祖先监听器（编辑器容器/document
  上的冒泡阶段监听器，它们不会查询 `ignoreEvent`），以及（b）CM6 自己那份与单元格原生
  光标无关的**文档选区**残留。具体修复：
  - "两个选中态并存"：进入单元格的 mousedown 被 CM6 忽略，意味着用户在外层文档里已有
    的**非空选区不会被这次点击清掉**，`drawSelection` 会继续把它画在表格旁边，与单元格
    内的原生选区并存。修复：单元格 `focus` 处理器发现外层选区非空时将其折叠到 head
    （`bindCellEvents` 的 focus 监听器）。原有的 `.xmd-cm-table-cell-active` 单一性
    清理（focus 时移除同表其它单元格的 active class）保留，保证任一时刻只有一个单元格
    呈激活态。
  - `keydown` 与 wrapper 的 `mousedown`/`pointerdown` 现在在 widget 边界调用
    `stopPropagation()`：对 CM6 是冗余（见上），但把单元格按键/表格 chrome 点击挡在
    app 层冒泡监听器（及未来代码）之外——与 `openTableContextMenu` 对 `contextmenu`
    的既有防御一致。window 捕获阶段的 `useAppShortcuts`（Cmd+B 等经
    `tableCellCommandBridge` 路由进单元格）先于该处理器执行，不受影响。拖拽穿越表格
    不产生源码内部选区，由 atomic range 本身保证（一步跨过整块）。
  - `insertTableCellSoftBreak`（Shift+Enter 软换行）原本在 `window.getSelection()`
    没有可用 range 时直接返回 `false`（什么也不做）。程序化 `element.focus()`
    （`focusCell`/`moveFocus` 做单元格间导航时使用）之后，浏览器发布新的 `Selection`
    range 不保证在同一个同步任务内完成，第一次 Shift+Enter 因此可能命中这个空档、
    静默失败，第二次才因为浏览器已经追上而生效。修复：找不到单元格内合法 range 时，
    退化为在单元格末尾新建一个折叠 range，而不是直接放弃。
  - 纵向格间导航补齐 goalColumn 语义：`TableWidgetController.verticalGoalX` 记住一串
    连续 ArrowUp/ArrowDown 跨格移动最初的屏幕 x 坐标（此前每跳一格都重读光标 x，经过
    窄格会被夹到格边、路径向内漂移），任何非纵向按键、格内纵向移动或指针操作都会重置。
    `cellAtHorizontalCoordinate` 的几何选择逻辑拆成纯函数
    `indexOfCellAtHorizontalCoordinate(rects, x)`（输入 `{left, right}` 而非真实 DOM
    元素）并配单元测试——之前这段逻辑完全依赖 `getBoundingClientRect()`，在 node/jsdom
    环境下无法验证。
  - 上/下边缘离开表格时，光标落点从 `table.from`/`table.to`（widget 自身边界，光标会
    贴在表格边上渲染）改为 `table.from - 1`/`table.to + 1`（真正进入上一行行尾/下一行
    行首，文档边界处夹紧）。
- 已知遗留缺口（记入下面的 Phase 4 验证清单）：`imagePreview.ts` 的
  `collectImageHiddenRanges` 只能排除**同步**可判定的回退到源码情形（
  `isSafeImageSource` 判定的危险协议、或 `allowRemote` 关闭时的远程地址）；一个"协议
  安全但网络请求实际失败"的图片仍会被登记为 atomic，即使它的 widget 因为异步解析失败
  而回退显示原始 Markdown 源码——原因是解析结果缓存活在 `imagePreview.ts` 自己
  ViewPlugin 实例的私有 `Map` 里，而 `hiddenRangeSource` 的 builder 只能看到
  `EditorState`，看不到这份视图私有、异步产生的数据。

## 后续阶段（Phase 4 验证清单，本阶段发现但未处理）

- 上面提到的 `imagePreview.ts` 异步解析失败场景：一个原本安全的图片源在网络请求失败后，
  其 Markdown 源码会变成不可编辑（atomic 但没有 widget 覆盖）。要精确修复，需要把
  "resolve 结果" 的落点从 ViewPlugin 私有缓存搬到 `EditorState`（比如参考
  `mathSourceRange`/`mermaidSourceRange` 的 `StateField` + `StateEffect` 模式），或者
  扩展 `hiddenRangesEngine()`，让它感知除 doc/selection/viewport/geometry/语法树之外
  的、由具体 feature 触发的自定义 rebuild 时机（类似 `viewportDecorationExtension` 的
  `rebuildOnUpdate` 选项）。
- Setext 标题下划线、链接引用定义整行目前依赖"整行内容被替换后视觉上和空行一样"这个
  技巧来获得可寻址性；没有专门测试覆盖它们的方向键遍历行为（用真实 EditorView 做
  `moveVertically`/`posAtCoords` 断言超出本阶段单测的性价比），值得用一次真实 EditorView
  集成测试补上——同样适用于代码块围栏、表格、图片、数学、Mermaid 的跳行/点击/拖拽行为。
  本阶段（Phase 3）对表格单元格交互的修复（focus 时折叠外层选区、Shift+Enter 选区
  时序、goalColumn、边缘离开落点）都是从代码走查中推导出的根因修复，没有真实浏览器环境
  验证，值得后续用集成测试或手动验收确认。
- `deleteTouchesHiddenMarker`（livePreview.ts）里"触碰到隐藏范围但不是 HR 就吞掉按键、
  什么也不做"的兜底分支是从旧代码原样保留的保守选择，没有专门测试。它可能已经是死代码
  （CM6 默认的原子范围感知删除很可能已经处理了这些情况）——值得用真实 EditorView 交互
  测试验证后再决定是否可以删除。
