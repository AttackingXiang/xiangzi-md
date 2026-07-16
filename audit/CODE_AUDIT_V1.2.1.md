# Xiangzi MD 1.2.1 全量代码审计

审计日期：2026-07-01  
基线提交：`2316d9d479b49a1b06466e9a0ca1916c1fd94b55`  
审计分支：`audit/v1.2.1-code-scan`  
版本一致性：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 均为 `1.2.1`

> 说明：第 3–5 节保留 2026-07-01 基线提交的历史发现，不代表当前分支仍存在这些问题。2026-07-16 的复核结果记录在第 2 节；除用户明确保留的“允许构建未签名安装包”外，本轮识别出的可执行整改均已落地。

## 1. 结论

审计基线的常规质量门禁是健康的：格式、ESLint、TypeScript、前端测试、构建、Rustfmt、Clippy 和 Rust 测试全部通过。当前复核中 npm audit 为 0；RustSec 对 macOS/Windows 发布目标无阻断漏洞，Linux-only 传递依赖例外见第 2 节。没有发现硬编码密钥、`unsafe` Rust、`eval`、`new Function` 或前端直接绕过 `DesktopPort` 的调用。

但“门禁通过”不等于可以无条件发布。本次审计确认了 6 项 P1 问题，其中保存竞态、文件权限变化、附件并发覆盖、会话恢复覆盖用户操作都可能造成数据丢失或数据属性损坏；设置损坏会导致应用无法启动；发布流程则没有被完整测试门禁和平台代码签名保护。建议先修复 P1，再发布下一版本。

| 级别 | 数量 | 定义                                   |
| ---- | ---: | -------------------------------------- |
| P0   |    0 | 可直接远程利用或已确认的大范围破坏     |
| P1   |    6 | 数据丢失、应用不可用、发布信任链缺口   |
| P2   |   10 | 安全边界、功能正确性、跨平台和测试缺口 |
| P3   |    6 | 维护性、性能、文档漂移和无用代码       |

## 2. 审计范围与结果

- 205 个受版本控制文件；核心 TypeScript/TSX/CSS/Rust 约 16,007 行。
- 全量扫描：危险 DOM API、路径与文件 API、IPC、异常吞噬、timer/listener、`unwrap/expect/panic/unsafe`、CI Secret、URL、死导出和依赖使用。
- 重点人工审阅：文件读写、附件、草稿、设置、搜索、资源协议、生命周期、更新器、导出、标签页/退出流程、GitHub Actions。
- `npm run check`：当前复核通过；68 个测试文件、576 项测试全部通过。
- `npm run rust:check`：当前复核通过；55 项 Rust 测试全部通过。
- `npm audit`：0 个漏洞。
- `cargo audit`：2026-07-16 复核无当前 macOS/Windows 发布目标的阻断漏洞；`plist 1.10.0` 已把发布链路升级到 `quick-xml 0.41.0`。锁文件中 Linux-only `wayland-scanner` 仍传递引用 `0.39.4`，RUSTSEC-2026-0194/0195 在 `.cargo/audit.toml` 中附带目标范围说明临时忽略；恢复 Linux 发布前必须移除忽略并升级上游。其余为 18 个允许的传递依赖告警。
- `knip`：当前复核通过；无用表格放大链路及重复配置已删除，动态导入保留显式配置。
- 覆盖率：`@vitest/coverage-v8` 已接入并设最低阈值；当前 statements 32.90%、branches 31.30%、functions 25.78%、lines 33.81%，门禁通过。
- Bundle：构建后脚本校验入口 gzip、最大 JS gzip 与 `dist` 总体积；当前分别约 171.1 KiB、171.1 KiB、9,414.6 KiB，均在预算内。

## 3. P1：发布前必须修复

### P1-01 异步保存会把保存期间的新编辑错误标记为“已保存”

位置：`src/hooks/useFileOps.ts:159-224`、`src/hooks/useFileOps.ts:234-248`

`saveTab`/`saveAsTab` 在发起请求时捕获旧 `tab.content`，等待 I/O 后却无条件对当前标签设置 `dirty: false`。如果用户在 I/O 完成前继续输入，磁盘仍是旧内容，内存是新内容，但 UI 会显示已保存；随后关闭窗口不会再提示，可能丢失新内容。快速连续保存还可能乱序完成，让旧请求覆盖新请求。

最小复现：让 `desktop.writeFile` 延迟；点击保存后继续输入；释放写入 Promise。此时磁盘是旧文本，标签的新文本却被标成 `dirty=false`。

最优方案：

1. 每次保存携带 `{ tabId, revision, content, expectedFileVersion }` 的不可变快照；
2. 每个 tab/path 使用串行队列，合并中间版本，只写最新版本；
3. 回调完成时只更新 `savedContent`，并按 `current.revision === savedRevision` 计算 `dirty`，禁止无条件清零；
4. 保存、关闭、退出使用同一状态机，保存期间禁止关闭或在完成后再次校验 revision；
5. 增加延迟 Promise、连续 Ctrl+S、保存中退出的确定性测试。

### P1-02 “原子保存”会替换 Unix 权限，并丢失文件元数据

位置：`src-tauri/src/infrastructure/workspace.rs:217-241`

文档保存通过 `NamedTempFile::new_in` 后 `persist` 覆盖原文件。`tempfile` 在 Unix 上默认以 `0600` 创建文件，因此原本 `0644`、组可读或有特殊权限的 Markdown 文件保存后会变成仅所有者可读写；rename 替换还可能丢失 ACL、扩展属性和其他文件元数据。当前也没有在 rename 后 fsync 父目录，掉电一致性不完整。

最优方案：读取原文件 metadata，在同目录临时文件上恢复权限；对 macOS/Windows 明确决定 ACL/xattr 保留策略；flush + `sync_all` 后原子替换，再 fsync 父目录。为 `0644`、只读文件、ACL/xattr 和异常中断增加平台测试。设置和草稿本来就应保持私有 `0600`，不要与用户文档共用同一个保存策略。

### P1-03 没有外部修改冲突检测，会静默覆盖其他编辑器的更改

位置：`src-tauri/src/domain/models.rs:21-27`、`src-tauri/src/infrastructure/workspace.rs:180-195`、`src-tauri/src/infrastructure/workspace.rs:217-241`

打开文件只返回路径、名称和正文；保存时无条件替换。文件被 Typora、Obsidian、Git checkout 或同步盘修改后，Xiangzi MD 仍会以旧基线覆盖新内容。这与 README 的“可继续用其他编辑器或 Git 管理”承诺冲突。

最优方案：读取时返回稳定版本指纹（mtime + size + inode/file ID，必要时加 BLAKE3）；写入时传 `expectedVersion` 并在 Rust 端 compare-and-swap，不匹配则返回 `file_conflict`；配合 `notify` 文件监听器弹出“重新加载 / 比较并合并 / 仍然覆盖”，禁止静默覆盖。

### P1-04 并发保存同名附件可能互相覆盖

位置：`src-tauri/src/infrastructure/attachment.rs:66-68`、`src-tauri/src/infrastructure/attachment.rs:74-99`

`unique_attachment_path` 先用 `exists()` 找空名称，随后用 `fs::write` 创建。两个并发上传可能同时选中同一路径，后写者会截断并覆盖先写者。一次粘贴多图或 WebView 并发上传即可触发。

最优方案：在循环内使用 `OpenOptions::create_new(true)` 原子抢占文件名，遇 `AlreadyExists` 才递增后缀；写入临时文件并 `persist_noclobber` 也可。增加 20~100 个并发同名附件测试，断言内容和文件数都完整。

### P1-05 会话恢复可能覆盖启动后用户新建或打开的标签

位置：`src/App.tsx:435-458`、`src/hooks/useFileOps.ts:349-377`

设置加载后 UI 已可交互，会话文件仍在异步读取；`restoreSession` 完成时直接 `setTabs(restored)`。如果用户在慢磁盘/网络盘恢复期间新建或打开文件，恢复结果会整组替换现有标签，未保存的新标签也可能消失。

最优方案：启动恢复使用显式 `restoring -> ready` 状态机；恢复完成前禁用会改变 tab 集合的入口，或按规范化路径合并恢复标签与实时标签，绝不覆盖 dirty tab；为“恢复中创建新文件/打开文件”增加受控 Promise 测试。

### P1-06 发布流程可能绕过完整门禁，且安装包没有平台代码签名

位置：`.github/workflows/release.yml:3-26`、`.github/workflows/release.yml:93-153`

Release 与 CI 在同一 push 上独立运行，Release 只执行前端门禁；它没有等待 CI 的 Rustfmt/Clippy/Rust 测试成功。Tauri 构建能证明可编译，但不能替代测试。macOS 明确使用 `APPLE_SIGNING_IDENTITY: '-'` 的 ad-hoc 签名，Windows 未配置 Authenticode。Tauri updater 的 minisign 能保护更新包，但不能替代首次下载的 OS 发布者身份、macOS notarization 和 Windows SmartScreen 信任。

最优方案：将“测试 → 多平台构建 → 平台签名/notarize → updater 签名 → 发布”合并为单一、不可跳过的 release graph；发布只由受保护的 `v*` 标签或 environment approval 触发；macOS 使用 Developer ID + notarization，Windows 使用受保护的代码签名证书；产物生成 SHA-256/SBOM 和 GitHub artifact attestation。GitHub 官方说明 artifact attestation 可提供与 workflow、仓库、commit SHA 和触发事件绑定的可验证构建来源：<https://docs.github.com/en/actions/concepts/security/artifact-attestations>。

## 4. P2：高优先级修复

### P2-01 二进制大小限制存在 TOCTOU，无法阻止超大内存分配

位置：`src/platform/tauriAdapter.ts:110-115`、`src-tauri/src/infrastructure/workspace.rs:197-215`、`src-tauri/src/infrastructure/protocol.rs:55-69`

前端先 invoke 检查 metadata，再调用 plugin-fs 整体读取；文件可在两次调用间被替换或增长，读取后的检查已经太晚。资源协议也在 metadata 后直接 `fs::read`，第二次大小检查发生在内存分配之后。

最优方案：只保留一个 Rust 命令，打开同一 file handle 后用 `take(limit + 1)`/分块读取，超过上限立即停止；同时返回 bytes，消除检查与使用分离。大图片导出应采用流式解码/缩放，而不是整文件复制 Rust→IPC→JS。

### P2-02 路径授权来源过宽，前端可把“设置值”升级成递归权限

位置：`src-tauri/src/infrastructure/settings.rs:484-511`、`src-tauri/src/infrastructure/workspace.rs:143-177`、`src-tauri/capabilities/default.json:7-18`

任意通过 `set_settings` 写入且当前存在的 favorites/recent/session/asset path 都会被 Rust 递归加入 fs/asset scope；`open_parent_folder` 还可以从一个合法目录逐级授权父目录。若前端因依赖、编辑器渲染或 WebView 漏洞被攻陷，攻击者可以把任意目录写入设置后授权，而不需要系统选择器。这削弱了 Tauri capability 用来限制“前端失陷影响面”的价值。

最优方案：Rust 维护不可由普通设置 patch 伪造的 `AuthorizedRoots`；只有系统文件选择器返回值、持久化 scope 中已存在的授权，或明确的原生确认动作才能新增 root。设置文件只保存引用，不授予权限。为自定义命令建立命令级权限/Scope，移除前端不需要的 `fs:default`，把二进制读写也收口到 Rust 命令。Tauri 官方强调 capability 旨在降低前端失陷影响，过宽 scope 和错误的命令校验不在框架保护范围内：<https://v2.tauri.app/security/capabilities/>、<https://v2.tauri.app/security/scope/>。

### P2-03 Rust 快捷键校验弱于前端，坏设置可持久化并导致下次启动失败

位置：`src/lib/shortcuts.ts:295-307`、`src-tauri/src/infrastructure/settings.rs:396-411`、`src-tauri/src/commands/settings.rs:16-26`

前端严格限制最后一个按键，Rust 只检查修饰键，`Mod+任意控制字符/未知键` 也会通过。`set_settings` 先写磁盘和缓存，再安装菜单；菜单安装失败后命令虽返回错误，坏设置已经持久化。下次启动仍会通过 Rust sanitize，随后菜单构建失败。

最优方案：前后端共享同一份动作和 key 枚举；先完整 validate 并试构建菜单，再原子提交设置；失败时不修改缓存或磁盘。至少加入非法末键、控制字符、重复修饰键、persist rollback 测试。

### P2-04 损坏或未来版本设置会让应用完全无法启动

位置：`src-tauri/src/infrastructure/settings.rs:193-209`、`src-tauri/src/lib.rs:28-33`、`src-tauri/src/lib.rs:72-73`

JSON 截断、超过 1 MB、schema 过新或 migration 错误会从 setup 向上传播，最终触发顶层 `expect`。这与架构文档“迁移失败回退默认值且不覆盖原数据”不一致。

最优方案：启动时把坏文件原样隔离为 `settings.corrupt-<timestamp>.json`，加载安全默认值并展示可恢复诊断；未来 schema 进入只读兼容模式，不降级覆盖；错误日志只记录 code 与脱敏路径。

### P2-05 文件夹搜索与索引静默截断，用户会误以为结果完整

位置：`src-tauri/src/infrastructure/search.rs:20-24`、`src-tauri/src/infrastructure/search.rs:96-98`、`src-tauri/src/infrastructure/workspace.rs:248-268`、`src/components/SearchPanel.tsx:107-115`

搜索在 3,000 文件/400 匹配时停止，命令索引在 8,000 文件时停止，但 DTO 没有 `truncated`/`scannedCount`，UI仍显示普通计数。大型仓库会漏结果且没有任何提示。

最优方案：返回 `{items, scannedFiles, totalMatches, truncated, reason}`；UI显示“结果已截断”；进一步可使用 Tantivy/SQLite FTS5 建增量索引、文件监听更新、流式分页和取消 token。

### P2-06 从全文搜索打开某一行时，定位参数实际上被忽略

位置：`src/components/FindBar.tsx:39-48`

`initialLine` 只用于判断是否大于 1，随后始终滚动到第一个 `.search-result-mark`。同一文件多次匹配时，点击第 N 行仍会跳到首个匹配。

最优方案：在打开文件时将行号转换为文档 offset/ProseMirror position；搜索结果携带 byte/UTF-16 offset 或上下文锚点，编辑器 ready 后设置 selection 并滚动到精确位置。加入重复关键词、多字节中文、文件在打开前发生变化的测试。

### P2-07 Windows 文件名验证不完整

位置：`src-tauri/src/infrastructure/workspace.rs:75-87`、`src-tauri/src/infrastructure/settings.rs:388-394`、`src-tauri/src/infrastructure/attachment.rs:74-99`

当前只拒绝分隔符、绝对路径和 `.`/`..`，未拒绝控制字符、`<>:"|?*`、尾随点/空格、`CON/PRN/AUX/NUL/COM1...` 等 Windows 保留名，也没有统一长度/UTF-16 边界。结果是在 UI 接受后由文件系统以泛化错误失败。

最优方案：建立 Rust `SafeFileName`/`SafeDirectoryName` 值对象，按目标平台验证并返回稳定错误码；附件目录、文档名、重命名全部复用；增加 Windows CI 参数化测试。

### P2-08 外部链接策略与工程规范不一致

位置：`src/App.tsx:1430-1441`、`docs/ENGINEERING_CONSTRAINTS.md:20`

规范要求 GitHub/Gitee 显式白名单，实际会把任意 `http://`/`https://` 链接交给系统浏览器。Markdown 文档可制造钓鱼链接；同时 `img-src ... https:` 允许任意远程图片，打开文档即可能向第三方泄露 IP、时间和请求信息。

最优方案：区分普通文档链接和应用官方链接；显示真实域名确认、默认只允许 HTTPS，官方更新/帮助使用固定 allowlist；为远程图片提供“默认不加载/按文档信任/代理缓存”隐私设置。Tauri 官方建议 CSP 尽可能只允许可信且最好自有的主机：<https://v2.tauri.app/security/csp/>。

### P2-09 GitHub Actions 供应链仍可加强

位置：`.github/workflows/*.yml`

- action 使用可移动 tag（`@v4`、`@v2`、`@v0.6.2`），未固定完整 commit SHA；
- `publish-gitee-release.yml:42` 把 `workflow_dispatch` 输入直接插入 shell，且只检查 `v*`，存在脚本注入面；
- `ssh-keyscan` 在运行时信任网络返回的 host key，没有固定 fingerprint；
- Gitee token 多次放在 URL query，可能进入代理、错误信息或审计日志；
- Gitee tag/updater 分支使用 `--force`，没有 environment 审批和 immutable release 保护。

最优方案：所有 action 固定完整 SHA并由 Dependabot更新；不可信 context 一律通过 `env` 传入并用 `^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$` 校验；固定 Gitee host key；token 使用 header/body；发布 secret 放受保护 environment，强制审批。GitHub 官方称完整 SHA 是 action 唯一不可变引用：<https://docs.github.com/en/actions/reference/security/secure-use>。

### P2-10 测试金字塔没有落地到关键风险路径

位置：`vitest.config.ts:3-9`、`docs/ENGINEERING_CONSTRAINTS.md:49-56`

现有测试主要覆盖纯函数，缺少 tab/save/session hook 的竞态测试、Rust 临时目录集成测试、DesktopPort 结构化失败契约、Tauri E2E、导出视觉回归。覆盖率配置存在，但缺依赖，CI也没有阈值。

最优方案：

1. Vitest + React Testing Library：可控 Promise/假时钟测试保存、恢复、退出、草稿；
2. Rust tempfile 集成测试：权限、原子替换、并发附件、冲突写、Windows 名称；
3. 对 DesktopPort 生成契约测试；
4. macOS WKWebView + Windows WebView2 的 Tauri E2E smoke；
5. 固定语料的 HTML/PDF/PNG 像素/结构快照；
6. 覆盖率先记录基线，再逐步设门槛，避免只追数字。

## 5. P3：计划性治理

### P3-01 `App.tsx` 和全局 CSS 已突破项目自己的结构约束

位置：`src/App.tsx`（1,701 行）、`src/styles/index.css`（2,917 行）、`docs/ENGINEERING_CONSTRAINTS.md:9`

`App.tsx` 同时负责 session、文件树、导出、命令面板、菜单、搜索、退出和布局，远超 400 行规则。最优拆分不是再加 region，而是按 `features/editor|workspace|session|export|settings|search` 垂直切片；`App` 只做装配。Rust 文档声明的 `application/` 层也尚未存在。

### P3-02 前端契约类型重复，已经形成漂移源

位置：`src/types.ts:1-84`、`src/platform/contracts.ts:1-70`

`FileNode/Folder/AppSettings/SearchResult/Draft*` 两处重复定义。应选单一来源：短期由 `platform/contracts.ts` 导出 UI 类型；中期从 Rust DTO 生成 TypeScript 绑定。若采用 `tauri-specta`，当前仍应锁定版本并先做稳定性评估，不能为了“先进”引入长期 RC 风险。

### P3-03 已确认的无用/冗余代码

- `src/lib/treeDrag.ts:3-63`：旧 HTML5 DataTransfer 拖拽路径已被 Pointer Events 替代，`TREE_DRAG_MIME`、`beginTreeDrag`、`peekTreeDrag`、`readTreeDrag`、`endTreeDrag` 均无调用；
- `src/hooks/useFileOps.ts:380-403`：`hasDirtyTabs` 返回给调用方但没有被解构使用；
- `src/lib/headingFold.ts:6`：`headingFoldKey` 仅文件内部使用，不需要 export；
- `src/lib/exportDocument.ts:200-202` 与 `src/platform/tauriAdapter.ts:52-54`：图片格式判断重复；
- `src/platform/contracts.ts` 与 `src/types.ts` 的 DTO 重复属于结构性冗余。

说明：`buffer` 被 depcheck/knip 报为未使用是误报，`src/lib/exportDocument.ts:262` 通过动态 `import('buffer')` 使用，不能删除。

### P3-04 自定义 CSS 切换到失效路径时会残留旧主题

位置：`src/hooks/useSettings.ts:70-97`

新 CSS 读取失败时 catch 什么也不做，已经存在的 `<style id="custom-theme-style">` 不会清空，UI设置和实际主题不一致。读取开始时先清空/标记 loading，失败后移除旧 style 并向用户显示错误。

### P3-05 性能预算缺少自动守门，文档基线已过期

位置：`docs/BASELINE.md:20-27`、`vite.config.ts:7-31`

基线仍写“前端 dist 约 152 KB、编辑器尚未导入”，当前 dist 已约 8.6 MB。构建警告 `Editor` 和其他 chunk 超过 500 kB（minified），但 CI 没有 bundle budget。建议用 `rollup-plugin-visualizer` 仅在分析任务生成报告，并用脚本校验入口/编辑器 gzip 预算；语言包按需加载，Mermaid diagram chunk 保持懒加载。不要仅为消警告调高阈值。

### P3-06 依赖升级应分层，不建议在修 P1 时顺手大版本升级

`npm outdated` 显示少量 patch 更新，以及 React 18→19、TypeScript 5→6、Lucide 大版本。当前 npm 无已知漏洞；优先做 Tauri 2.11.3→2.11.4 等 patch，并独立回归。React 19/TS 6 应单独 ADR、单独分支，先验证 Milkdown/Crepe、WebView 和 ESLint 兼容，不属于本轮数据安全修复。

Linux 目标目前未发布，但 `cargo audit` 在 Linux target 上发现 `glib 0.18.5` unsound 警告及 GTK3 停止维护链；若恢复 Linux 发布，必须先升级到已修复的 glib/GTK/WebKit 依赖链并加入 Linux CI。`bincode 1.3.3` 的停止维护来自 `tauri-plugin-persisted-scope`，应跟踪上游替换，而不是在应用层直接强行改版本。

## 6. 推荐实施顺序

### 第一批：数据安全补丁

1. 保存队列 + revision 校验；
2. 文件版本冲突检测；
3. 保留权限/元数据的原子保存；
4. 附件 `create_new`；
5. session restore 合并/阻塞；
6. 为以上路径补确定性测试。

### 第二批：安全边界与发布链

1. Rust 独占文件字节读取，消除 TOCTOU；
2. 授权 root 与普通 settings 分离，收紧 capability/CSP/URL；
3. 设置容灾和完整快捷键校验；
4. release 强制依赖全门禁、平台代码签名/notarization；
5. action SHA pin、environment approval、SBOM、artifact attestation。

### 第三批：结构与性能

1. 拆分 `App.tsx` 和 CSS；
2. 单一 DTO/生成绑定；
3. 搜索结果协议增加进度/截断信息，评估增量索引；
4. 删除已确认死代码；
5. 建立 coverage、bundle、E2E、视觉回归门禁；
6. 单独评估 React 19、TypeScript 6 和编辑器依赖升级。

## 7. 当前可以保留的设计

- `DesktopPort` 将所有 Tauri JS API 收口在 adapter，边界方向正确；
- Rust command 基本保持薄层，阻塞 I/O 使用 `spawn_blocking`；
- 路径 scope、符号链接解析、文件/附件/草稿上限、搜索取消已有基础；
- 设置 patch 在 Rust 锁内完成读改写，避免无关字段互相覆盖；
- 草稿 ID 防穿越、大小/数量/总量限制和原子写设计合理；
- Mermaid 使用 `securityLevel: 'strict'`，CSP 已启用；
- updater 已启用签名，GitHub/Gitee manifest 共享签名信任链；
- npm/Cargo lockfile、Dependabot、Clippy `-D warnings`、零 warning 前端门禁均已建立。

这些基础值得保留。最优路线不是重写整个应用，而是先把文件一致性、授权来源和发布门禁补成真正的系统不变量，再做结构拆分与技术升级。
