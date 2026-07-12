# 迁移计划

## 总原则

这是并行重构，不是一次性重写。每个阶段都必须能单独验收，Electron 版在 Tauri 版达到发布门槛前继续作为正式版本。

## Phase 0：基线与高风险验证

1. 固化一套测试资料库：中英文、emoji、表格、KaTeX、Mermaid、本地/网络图片、超长文档、不同编码和异常路径。
2. 在同一台 macOS 和 Windows 机器记录 Electron 的安装包、安装后体积、冷启动、热启动、空闲 RSS、打开大文档后的峰值。
3. 先做 PDF/PNG/JPG 导出 spike，结论写入 ADR；此项不通过，不进入正式切换。
4. 保存 Electron 导出结果作为视觉回归基准。

退出条件：性能基线可复现，导出路线在 macOS/Windows 都有原型和数据。

## Phase 1：本地数据与工作区

- 设置 schema、Electron 设置迁移、最近记录、收藏、会话恢复；
- 打开文件/文件夹、懒加载树、读写、另存为、新建、重命名、移动、回收站、访达/资源管理器定位；
- 附件五种存放模式和唯一命名；
- 运行期路径授权与安全测试。

退出条件：相关 Rust 单元测试通过，手工验收数据不丢失，旧设置可无损导入。

## Phase 2：编辑与检索

- 原样迁移 React 组件、Milkdown 插件、CodeMirror 和样式；
- 替换 `window.api` 为 `DesktopPort`，UI 内不得出现 Tauri import；
- 查找替换、全文搜索、命令面板、大纲折叠/拖拽、表格缩放；
- Mermaid、KaTeX、本地资源协议、自定义 CSS；
- 自动保存和未保存状态。

退出条件：编辑测试语料不会产生意外 Markdown diff，功能对照表对应项全部通过。

## Phase 3：桌面集成

- 原生菜单与双语切换；
- 单实例、文件关联、首次/二次启动打开路径；
- 关闭窗口脏数据确认；
- 外部链接白名单、系统主题、窗口尺寸；
- GitHub/Gitee 更新检查。

退出条件：macOS arm64/x64 与 Windows x64 逐项手工验收。

## Phase 4：导出与性能

- 根据 ADR 实现 HTML、PDF、PNG/JPG；
- 视觉快照对比和超长文档压力测试；
- 优化搜索取消、附件传输、前端 chunk 和启动路径；
- 建立安装包、启动和内存预算。

退出条件：导出保真通过，Tauri 相对 Electron 的安装体积至少下降 60%，关键操作没有用户可感知退化。

## Phase 5：发布切换

- CI 构建 macOS arm64/x64 与 Windows x64；
- 代码签名、notarization/签名证书、更新清单签名；
- 候选版与 Electron 版并行灰度；
- 备份并演练回滚；
- 最终恢复产品名 `Xiangzi MD` 和原 bundle identifier。

只有 [功能对照表](FEATURE_PARITY.md) 全绿、无 P0/P1 缺陷、设置迁移成功、性能预算达标，才能替换原发布渠道。
