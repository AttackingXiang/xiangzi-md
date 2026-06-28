# Xiangzi MD 1.1 工程、性能、安全与体验审计

审计日期：2026-06-28
范围：Tauri `main` 工作树，macOS aarch64 本地签名构建；Windows 由同一锁文件和 CI 矩阵验证。

## 结论

本轮未发现仍可稳定复现的 P0/P1 数据损坏或远程代码执行问题。已修复会话覆盖、设置并发写丢失、无界文件/附件读入、资源协议宽松 CORS、发布版开发者工具、工作区预扫描和异步树节点清理等高价值问题。应用仍是轻量原生 WebView 架构，没有引入 Chromium、Node sidecar 或常驻更新进程。

## 证据

截图保存在以下本地路径供当前工作区复核；它们可能包含用户文档和绝对路径，因此被 `.gitignore` 排除，不发布到公开仓库。

- 改造前编辑器：[`current-state/01-editor.png`](current-state/01-editor.png)
- 改造前设置：[`current-state/02-settings.png`](current-state/02-settings.png)
- 最终编辑器：[`final-state/01-editor.png`](final-state/01-editor.png)
- 最终设置：[`final-state/02-settings.png`](final-state/02-settings.png)
- 自定义快捷键：[`final-state/03-shortcuts.png`](final-state/03-shortcuts.png)
- 软件更新：[`final-state/04-updates.png`](final-state/04-updates.png)
- 固定关闭按钮：[`final-state/05-sticky-close.png`](final-state/05-sticky-close.png)

## 已修复问题

| 等级 | 领域     | 原问题                                                           | 处理结果                                                                   |
| ---- | -------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1   | 数据     | 异步会话恢复期间可能先写入空会话，覆盖保存的标签                 | 增加 `sessionRestored` 门闩；恢复完成后才允许持久化                        |
| P1   | 数据     | 多个 Tauri 设置命令可在读写之间互相覆盖                          | Rust mutex 覆盖完整 read-modify-write 事务，临时文件原子落盘               |
| P1   | 供应链   | 自动更新缺少签名发布链路与国内回退                               | 官方 updater、内置公钥、GitHub→Gitee fallback、CI 产物签名与 manifest 同步 |
| P1   | 安全     | 自定义 `xmd` 协议返回 `Access-Control-Allow-Origin: *`           | 只允许 Tauri 应用源，并增加 `nosniff`                                      |
| P1   | 内存     | 文档与附件可无界读入 WebView/IPC                                 | 文档 20 MB、附件 20 MB、恢复标签 12 个上限；前后端双重校验                 |
| P2   | 性能     | 打开工作区后命令面板立即递归索引最多 8000 文件                   | 只有打开命令面板时才索引；关闭后释放列表                                   |
| P2   | 性能     | 大纲关闭时仍随每次输入解析全文                                   | 仅可见时解析，并使用 deferred content                                      |
| P2   | 生命周期 | 文件树异步加载、拖动和表格缩放可能在卸载后更新状态或遗留全局样式 | 增加 mounted/loading guard 和完整 cleanup                                  |
| P2   | 跨平台   | 重命名/移动目录后打开标签路径可能失效，Windows 分隔符匹配不完整  | 统一路径替换，重命名/移动后同步标签                                        |
| P2   | 安全     | 发布构建包含 devtools feature 和菜单入口                         | 移除 release devtools feature 与菜单入口                                   |
| P2   | 体验     | 设置为单列长表单，关闭按钮随内容滚动                             | 分类导航、卡片布局、独立滚动区、顶部固定关闭按钮                           |
| P2   | 体验     | 快捷键不可定制，菜单与编辑器键位分散                             | 统一动作模型、录制/冲突检测/恢复默认、Rust 白名单和持久化                  |

## 目录与内存模型

文件树原本就只读取当前层级，展开文件夹时才调用 `read_dir`；本轮保留了这一正确策略，并补充加载与空目录状态。会递归遍历的全文搜索和命令面板索引都只由用户显式触发。最坏情况下 12 个恢复标签仍可能占用约 240 MB 文本内存，因此不建议把二进制或超大日志伪装为 Markdown；Rust 的 20 MB 单文件门槛会在进入 WebView 前拒绝。

前端产物约 8.5 MB；macOS `.app` 约 17 MB，DMG 约 8.2 MB，updater archive 约 9.0 MB。编辑器 chunk 约 877 KB（gzip 273 KB）按文档打开懒加载；设置约 15 KB，更新提示约 2 KB。Mermaid 图类型和导出依赖继续按需拆包，不进入欢迎页首屏。

## 安全扫描

- `npm audit --omit=dev`：0 个已知漏洞。
- `cargo audit`：0 个阻断漏洞；报告 18 个 warning。GTK3/glib 项来自 Tauri 的 Linux target 依赖，不进入当前 macOS/Windows 产物；`bincode` 来自 persisted-scope，其他 UNIC/proc-macro 项为 Tauri 构建链传递依赖。它们标记为 unmaintained/unsound warning 而非可利用漏洞，继续由 Dependabot 和 Tauri 升级窗口跟踪。
- CSP 限制脚本到应用自身；外部链接交给系统浏览器；文件访问仍由对话框和运行时 scope 授权。
- Tauri 的 `freezePrototype` 与当前 Milkdown/ProseMirror 不兼容，会导致编辑器空白，因此未启用；这一点通过最终可视回归验证，而不是静默保留一个破坏功能的“安全开关”。

## 维护性结论

本轮把快捷键规则、全局键盘分发、更新状态机、设置页和更新提示拆成独立模块，并保持 React 只依赖 `DesktopPort`/`UpdaterPort`。`App.tsx` 仍是 1000 行级的组合根，`styles/index.css` 仍是 2000 行级迁移样式：它们是当前最明确的 P2 维护债。继续机械拆分可以降低行数，但会扩大本次发布回归面；下一轮应优先把 export、menu/palette orchestration 和 settings/editor CSS 按 feature 移出，且不同时改变行为。

## 质量门结果

- 前端：21 项测试通过，TypeScript strict、ESLint、Prettier、生产构建通过。
- Rust：9 项测试通过，`cargo fmt`、Clippy `-D warnings`、locked test 通过。
- 工作流：全部 YAML 可解析；Git diff whitespace 检查通过。
- 本地签名构建：`.app`、DMG、updater archive 和 `.sig` 均成功生成。
- 实机：编辑器、设置分类、快捷键滚动、固定关闭按钮、更新状态页通过 macOS 回归。

## 发布前唯一外部配置

GitHub 仓库必须存在 `TAURI_SIGNING_PRIVATE_KEY` Actions Secret。私钥已在本机生成并用于本次签名构建，但不能提交 Git；没有该 Secret 时，GitHub 自动打包会按安全设计失败。配置方式见 [`../docs/UPDATE_SIGNING.md`](../docs/UPDATE_SIGNING.md)。
