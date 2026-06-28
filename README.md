# Xiangzi MD 1.1

Xiangzi MD 1.1 是基于 Tauri 2、Rust、React 和 Milkdown 的本地优先 Markdown 编辑器。Electron 旧版保存在仓库的 `electron-legacy-v0.1` 分支；`main` 维护 Tauri 版本。

编辑器、工作区、搜索、设置、菜单、单实例、退出保护以及 HTML/PDF/PNG/JPG 导出已经迁移。1.1 新增签名自动更新（GitHub 优先、Gitee 回退）、可冲突检测的自定义快捷键和分类设置页。PDF 当前采用分页位图，完整文档可导出；可选择文字和可点击链接仍在原生导出适配计划中。详细完成度见 [功能对照表](docs/FEATURE_PARITY.md)。

## 技术基线

- Tauri 2 + Rust
- React 18 + TypeScript + Vite
- Milkdown/Crepe、CodeMirror、Mermaid 暂时锁定为旧项目实际安装版本
- npm 与 Cargo lockfile 必须提交，CI 只允许 `npm ci` 和 `cargo --locked`

正式应用标识为 `com.guoxiangzi.xiangzimd`。

## 本地开发

先安装 Node 22 和 Rust stable。macOS 还需要 Xcode Command Line Tools；其他平台见 Tauri 官方前置条件。

```bash
npm ci
npm run check
npm run tauri:dev
```

```bash
npm run rust:check
npm run tauri:build
```

也可直接使用仓库的 `mise.toml` 安装并切换到 Node 22 / Rust stable：

```bash
mise install
mise run check
```

## 文档入口

- [架构说明](docs/ARCHITECTURE.md)
- [迁移计划](docs/MIGRATION_PLAN.md)
- [功能对照表](docs/FEATURE_PARITY.md)
- [工程约束](docs/ENGINEERING_CONSTRAINTS.md)
- [更新签名与发布](docs/UPDATE_SIGNING.md)
- [1.1 工程与体验审计](audit/ENGINEERING_UX_AUDIT.md)
- [扫描与体积基线](docs/BASELINE.md)
- [macOS 验收记录](docs/QA_MACOS_2026-06-27.md)
- [导出能力技术决策](docs/adr/0001-export-parity-spike.md)

## 自动发布

版本号变更推送到 `main` 后，GitHub Actions 会为该版本自动创建 GitHub Release，并分别构建 macOS Universal DMG 与 Windows x64 NSIS。发布成功后会自动同步安装包、更新签名和 `latest.json` 到 Gitee；普通代码提交仍只运行 CI 和源码镜像，避免重复发布同一版本。

发布前必须在 GitHub Actions 配置 `TAURI_SIGNING_PRIVATE_KEY`。私钥不得提交仓库，配置和轮换步骤见 [更新签名与发布](docs/UPDATE_SIGNING.md)。
