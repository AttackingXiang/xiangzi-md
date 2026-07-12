# 功能对照表

状态：✅ 已在 macOS/Windows 完成代码、自动化与手工验收；🟡 已迁移但仍缺至少一项跨平台验收；⬜ 尚未迁移。

| 领域   | 现有能力                                 | Tauri 落点                       | 状态 |
| ------ | ---------------------------------------- | -------------------------------- | ---- |
| 基础   | React 与 Rust 类型化平台契约             | `src/platform` + commands        | 🟡   |
| 编辑器 | Milkdown/Crepe 所见即所得                | 复用现有组件与插件               | 🟡   |
| 编辑器 | CodeMirror 源码模式                      | 复用 `SourceEditor`              | 🟡   |
| 编辑器 | Markdown 无损读写                        | 语料 round-trip 回归             | ⬜   |
| 编辑器 | 标题 1–6、正文、列表、引用、代码等快捷键 | 复用 ProseMirror keymap          | 🟡   |
| 编辑器 | 标题折叠、表格列宽调整                   | 复用插件并补测试                 | 🟡   |
| 编辑器 | 专注模式、打字机模式                     | React 状态                       | 🟡   |
| 编辑器 | Mermaid 预览/源码切换                    | 复用懒加载渲染器                 | 🟡   |
| 编辑器 | KaTeX 行内/块公式                        | Milkdown feature                 | 🟡   |
| 文件   | 打开单文件与文件夹                       | Rust dialog + workspace service  | 🟡   |
| 文件   | 文件树按层懒加载                         | Rust read_dir                    | 🟡   |
| 文件   | 新建文件/目录、重命名、移动              | Rust workspace service           | 🟡   |
| 文件   | 删除到回收站                             | Tauri/Rust 系统适配              | 🟡   |
| 文件   | 在访达/资源管理器中显示                  | 受限系统适配                     | 🟡   |
| 文件   | 多标签页与定位当前文件                   | 复用 React 逻辑                  | 🟡   |
| 文件   | 保存、另存为、自动保存                   | Rust 原子写入                    | 🟡   |
| 附件   | 粘贴/拖入图片                            | DesktopPort + Rust               | 🟡   |
| 附件   | 五种 Obsidian 风格存放模式               | attachment service               | 🟡   |
| 附件   | 额外图片目录与 fallback                  | 受权资源协议                     | 🟡   |
| 附件   | 最大显示宽度                             | 复用编辑器配置                   | 🟡   |
| 导航   | 大纲点击与拖拽重排                       | 复用 React/ProseMirror           | 🟡   |
| 检索   | 编辑器内查找替换                         | 编辑器插件/CodeMirror            | 🟡   |
| 检索   | 跨文件全文搜索                           | 有界 Rust search service         | 🟡   |
| 检索   | 命令面板与文件快速打开                   | Rust 索引 + React                | 🟡   |
| 状态   | 最近文件/文件夹、收藏                    | versioned settings               | 🟡   |
| 状态   | 上次会话恢复                             | versioned settings               | 🟡   |
| 状态   | Electron 设置一次性迁移                  | migration service                | 🟡   |
| 外观   | 系统/浅色/深色主题                       | React + system theme             | 🟡   |
| 外观   | 编辑区三档宽度、标题编号                 | 复用 CSS/设置                    | 🟡   |
| 外观   | 自定义 CSS 主题                          | 明确授权的 CSS 文件              | 🟡   |
| 外观   | 中英文界面和菜单                         | i18n + native menu               | 🟡   |
| 导出   | HTML（含图片内嵌与样式）                 | Tauri dialog + Rust atomic write | 🟡   |
| 导出   | PDF 完整文档                             | DOM 分页位图；原生适配待补       | 🟡   |
| 导出   | PNG/JPG 长图（最大 20000px 行为）        | DOM 分段渲染 + 二进制编码        | 🟡   |
| 桌面   | 原生菜单与所有快捷键                     | Tauri menu + events              | 🟡   |
| 桌面   | 关闭窗口时未保存确认                     | close-request handshake          | 🟡   |
| 桌面   | 单实例与二次启动聚焦                     | single-instance plugin           | 🟡   |
| 桌面   | `.md`/`.markdown` 文件关联               | bundle config + open event       | 🟡   |
| 桌面   | 外部链接用系统浏览器                     | opener URL scope                 | 🟡   |
| 更新   | GitHub 优先、Gitee fallback 检查         | Rust HTTP + dialog               | ⬜   |
| 发布   | macOS arm64/x64 DMG                      | CI + 签名/公证                   | 🟡   |
| 发布   | Windows x64 NSIS/便携版                  | CI；便携包另行验证               | ⬜   |

“✅”必须同时满足：代码、自动化测试、对应平台手工验收记录三者齐全；仅仅能编译不能标绿。

macOS 当前验收记录见 [QA_MACOS_2026-06-27.md](QA_MACOS_2026-06-27.md)。
