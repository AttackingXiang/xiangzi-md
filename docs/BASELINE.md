# 扫描与体积基线

采集时间：2026-06-27，macOS arm64。这里只记录当前工作区可复现的数据；完整 Electron 安装包、启动和内存数据仍需按迁移计划补测。

## Electron 现状

- 约 7,090 行应用代码，其中 `App.tsx` 776 行、主进程 IPC 436 行、全局 CSS 1,731 行；
- `node_modules` 约 858 MB；
- Electron 自带运行时目录约 242 MB，其中 `Electron.app` 约 233 MB；
- 已构建的前端/主进程输出 `out` 约 12 MB；
- 没有单元测试、lint、format、typecheck 独立门禁；
- `tsconfig.node.tsbuildinfo` 在扫描前已有未提交改动，本次未修改旧项目。

`node_modules` 属于开发环境体积，不能直接等同安装包；但 Electron 运行时目录解释了应用发布体积的主要固定成本。

## Tauri 骨架

- macOS `.app`：约 8.1 MB；
- release 可执行文件：约 7.9 MB；
- 当前前端 `dist`：约 152 KB；
- npm audit：0 vulnerabilities；
- 前端门禁：format、ESLint、Vitest、TypeScript、Vite build 全通过；
- Rust 门禁：rustfmt、Clippy `-D warnings`、cargo test 全通过；
- Tauri release `.app` 构建成功。

这个 8.1 MB 只是迁移骨架，编辑器代码尚未导入，因此不能当作最终体积承诺。Milkdown/Mermaid 已锁在依赖中，但没有被入口引用，Vite 会 tree-shake；完整迁移后必须重新测量。

## 已识别结构问题

1. Electron 平台能力集中在单个 436 行 `ipc.ts`，文件、搜索、附件、设置和导出耦合；
2. `App.tsx` 同时编排 session、面板、导出、菜单、搜索、窗口关闭等多类状态；
3. 主进程与渲染进程各自复制 `AppSettings` / `FileNode` 类型，存在契约漂移；
4. IPC 接受任意绝对路径，缺少 workspace 授权边界与结构化错误；
5. 设置文件没有 schema version，迁移和字段校验不足；
6. PDF/长图依赖 Electron Chromium 专有接口，是 Tauri 替换的首要技术风险；
7. 搜索串行遍历并整文件读取，有硬上限但没有取消、单文件大小限制或进度；
8. 发布流程未进行代码签名，Tauri updater 若启用还需要更新产物签名体系。
