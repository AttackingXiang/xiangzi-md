# 工程约束

以下是合并门槛，不是建议清单。

## 架构

1. React 功能代码不得直接导入 `@tauri-apps/*`，统一依赖 `DesktopPort`。
2. Tauri commands 不写业务算法；可测试逻辑放 application/domain/infrastructure。
3. 单文件原则上不超过 400 行；超过时按职责拆分，不以 region 注释掩盖耦合。
4. 新能力先扩展契约与验收用例，再实现 Rust 和 UI；禁止在 UI 中临时拼命令字符串。
5. 迁移阶段禁止顺手升级编辑器、React 或重做 UI。此类变更单独 ADR、单独 PR。

## 安全与数据

1. 默认拒绝文件系统访问，只允许系统对话框或既有设置明确授权的根目录。
2. 所有路径 canonicalize 后校验边界；符号链接、`..`、UNC、Windows 盘符大小写必须测试。
3. 文件保存使用“同目录临时文件 → flush/sync → 原子替换”；失败不得损坏原文档。
4. 设置包含 `schemaVersion`，migration 必须幂等；旧 Electron 数据只读导入，绝不原地修改。
5. 自定义 CSS 只作为文本注入，禁止其中获得额外 Tauri 权限。
6. 外部 URL 仅允许 `https://github.com/AttackingXiang/` 和 `https://gitee.com/tlqgyx/` 等显式白名单。
7. capability 最小授权；禁止 `fs:allow-*` 全盘通配和 CSP `null`。
8. 日志不得包含文档正文、附件字节、用户主目录全路径或密钥。

## Rust

1. command 调用链中禁止 `unwrap()`、`expect()`、`panic!()`；顶层无法恢复的 app run 除外。
2. 统一 `AppError { code, message, details, retryable }`，错误码稳定且可测试。
3. 阻塞文件遍历和图片/PDF 处理不得占用 async runtime；使用专用线程并支持取消。
4. 递归搜索必须有文件数、结果数、单文件大小和忽略目录上限。
5. `cargo fmt --check`、`clippy -D warnings`、`cargo test --locked` 全部通过。

## TypeScript / React

1. `strict` 保持开启；禁止 `any`、漂浮 Promise 和无说明的类型断言。
2. 可复用业务规则写纯函数并单测；组件负责组合，不负责文件系统协议。
3. 订阅、timer、编辑器实例都必须在 effect cleanup 中释放。
4. 异步搜索、打开和导出要处理重复请求、过期响应、取消与错误提示。
5. `npm run check` 必须通过且零 warning。
6. 快捷键只允许来自受支持动作白名单，并在前端录制和 Rust 落盘两层拒绝重复或无修饰键组合。

## 依赖与供应链

1. `package-lock.json` 与 `Cargo.lock` 必须提交；CI 只用 lockfile 安装。
2. 生产依赖新增需要说明必要性、体积、许可证、维护状态和可替代方案。
3. 禁止通过引入 Chromium/Node sidecar 来“临时”补齐导出，除非 ADR 证明体积目标仍达标。
4. 高危/严重漏洞阻断发布；中危漏洞必须有到期日明确的风险接受记录。
5. 自动更新必须启用签名；更新私钥只能存在于开发机密钥库和 CI Secret，禁止进入 Git、日志或构建产物。

## 测试金字塔

- Rust 单测：路径安全、唯一命名、设置 migration、搜索边界、附件模式；
- TypeScript 单测：编辑纯函数、平台参数映射、tab/session 状态；
- 契约测试：每个 DesktopPort 方法至少一个成功和一个结构化失败样例；
- 集成测试：临时目录内完成打开、编辑、保存、移动、搜索、恢复；
- 平台手测：菜单、文件关联、单实例、回收站、导出、更新、退出确认；
- 视觉回归：固定语料的编辑器和三种导出与 Electron 基线对比。

## 性能预算

在相同机器与语料上测量；数据写入 release 记录。

- 安装包/压缩产物相对 Electron 至少减少 60%；
- 冷启动到可编辑 p95 不超过 1.5 秒，且不得慢于 Electron；
- 空闲 RSS 至少减少 35%，大文档峰值不得高于 Electron；
- 3000 文件全文搜索可取消，取消后 200ms 内不再推送结果；
- 前端首屏 chunk 预算 500 KiB gzip，编辑器/Mermaid 保持异步 chunk。

预算不达标必须修复或通过 ADR 调整，不能静默放宽。

## 完成定义

一项功能只有在实现、测试、文档、macOS/Windows 验收、错误与取消路径、性能影响都完成后，才能在功能对照表标记为 ✅。
