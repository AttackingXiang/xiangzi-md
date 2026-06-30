# Xiangzi MD

> 写 Markdown，不该像在调试格式。

Xiangzi MD 是一款开源、本地优先的所见即所得 Markdown 编辑器，支持 macOS 和 Windows。

我喜欢 Typora 那种“光标走到哪儿，文字就在哪里成形”的感觉，但日常写文档时，我还经常要在一个文件夹里来回切换、全局找一句话、让图片乖乖待在约定目录，最后再把整篇内容连图复制给同事。Xiangzi MD 就是沿着这些小麻烦，一点点长出来的。

如果你正在找一个更自由的 Typora 替代，它值得试一圈：不用注册账号，不接管你的文件，也没有私有文档格式。不喜欢就关掉，原来的 `.md` 还安安稳稳待在原处。

[下载最新版](https://github.com/AttackingXiang/xiangzi-md/releases/latest) · [使用说明](docs/USER_GUIDE.md) · [提交问题或建议](https://github.com/AttackingXiang/xiangzi-md/issues)

![Xiangzi MD 工作区与所见即所得编辑](docs/images/user-guide/01-workspace.png)

## 它哪里顺手

- **文件永远是你的**：直接读写本地 `.md` 文件，可继续用 Typora、Obsidian、VS Code 或 Git 管理。
- **写作和源码随时切换**：所见即所得与源码模式编辑的是同一份 Markdown，不需要来回导入导出。
- **不只会开一个文件**：文件夹工作区、多标签页、会话恢复、文件夹全文搜索和命令面板都内置好了。
- **技术文档直接写**：支持 GFM 表格、代码高亮、Mermaid、KaTeX、任务列表和脚注。
- **图片不再到处乱跑**：支持粘贴、拖入、预览，以及五种附件归档规则；整篇内容连同图片可直接复制到 Word、飞书或邮件。
- **交付方式够多**：可导出完整 HTML、多页 PDF、PNG 或 JPEG 长图，并保留当前主题、代码、公式和图表效果。
- **细节可以自己定**：专注模式、打字机模式、中英文界面、自定义 CSS，以及会检查冲突的自定义快捷键。

![Mermaid、KaTeX 与代码高亮](docs/images/user-guide/02-rich-rendering.png)

## 和 Typora 相比

Xiangzi MD 保留了原地渲染的写作体验，同时把我自己经常缺的东西补了进来：多标签页、工作区全文搜索、命令面板、可拖拽重排的大纲、更细的图片目录规则，以及 PNG/JPEG 长图导出。

它也还不完美。目前 PDF 为了保持排版一致，采用分页位图，文字不能选择或搜索；源码模式支持查找但暂不支持替换；Linux 安装包也还没准备好。项目仍在持续更新，遇到别扭的地方，欢迎直接提 [Issue](https://github.com/AttackingXiang/xiangzi-md/issues)。

## 下载与安装

- macOS：下载 Universal DMG，同时支持 Apple Silicon 和 Intel Mac。
- Windows：下载 x64 安装程序。

安装包都在 [GitHub Releases](https://github.com/AttackingXiang/xiangzi-md/releases/latest)。如果 GitHub 访问不方便，也可以使用 [Gitee Releases](https://gitee.com/tlqgyx/xiangzi-md/releases)。应用支持签名自动更新，更新检查会优先访问 GitHub，失败后回退到 Gitee。

## 本地开发

项目基于 Tauri 2、Rust、React 18、TypeScript 和 Milkdown。先准备 Node 22、npm 10 和 Rust stable；macOS 还需要 Xcode Command Line Tools。

```bash
npm ci
npm run check
npm run tauri:dev
```

```bash
npm run rust:check
npm run tauri:build
```

也可以使用仓库里的 `mise.toml`：

```bash
mise install
mise run check
```

更多资料：

- [渲染效果示例](docs/RENDERING_SHOWCASE.md)
- [功能与平台验收状态](docs/FEATURE_PARITY.md)
- [架构说明](docs/ARCHITECTURE.md)
- [工程与体验审计](audit/ENGINEERING_UX_AUDIT.md)
- [更新签名与发布](docs/UPDATE_SIGNING.md)

## English

Xiangzi MD is an open-source, local-first WYSIWYG Markdown editor for macOS and Windows. It edits ordinary `.md` files and combines in-place rendering with workspace folders, tabs, full-text search, a command palette, Mermaid and KaTeX support, flexible local image handling, and HTML/PDF/PNG/JPEG export. Built with Tauri 2, Rust, React, and Milkdown. Licensed under MIT.

If Xiangzi MD saves you a little friction, a star helps more people find it. Bug reports and honest feedback are equally welcome.
