# ADR-0001：先验证 PDF 与长图导出，再承诺切换

- 状态：Accepted for alpha；正式切换前仍需原生 PDF 适配
- 日期：2026-06-27

## 背景

Electron 版通过隐藏 Chromium `BrowserWindow` 实现 `printToPDF()` 和 `capturePage()`。Tauri 使用系统 WebView，JavaScript API 没有与这两个 Electron API 完全等价的跨平台接口。PDF 与长图因此是本次迁移的最高风险，不应留到最后。

## 候选方案

1. DOM 转 Canvas/图片，PDF 再由图片分页：跨平台简单，但文字不可选择、超长文档内存大、CSS/字体保真较差。
2. macOS 使用 WKWebView PDF 能力、Windows 使用 WebView2 PrintToPdf，封装为自有 Tauri 插件：最接近现有效果，但需要平台代码和双平台维护。
3. 携带 Chromium/headless sidecar：保真较容易，但会重新引入体积、攻击面和更新负担，违背重构目标。
4. 调用系统打印对话框：适合“打印”，但无法稳定实现用户选择路径后的无交互导出。

## 决策

Alpha 阶段采用方案 1，所有依赖按需加载：HTML 直接原子写入；PNG/JPG 以 920px 宽、4000px 一段渲染后编码，最大高度保持 20000px；PDF 将同一导出 DOM 按 A4 分页，尽量避开块级内容中部，再写成位图 PDF。

这一实现恢复了可用的跨平台导出入口，同时避免重新携带 Chromium。macOS 本地语料已验证 920 × 6066 PNG、JPEG 和 5 页 PDF 的有效文件头与可见内容；新增依赖后 `.app` 约 14 MB、`.dmg` 约 6.7 MB。

它不是最终保真结论：位图 PDF 不能提供可选择文字和可点击链接。正式切换前继续实现方案 2，在 `DesktopPort` 后增加 macOS WKWebView 与 Windows WebView2 原生 PDF 适配器；DOM PDF 保留为受控 fallback。Chromium sidecar 仍不进入默认方案。

测试语料必须覆盖：中文字体、emoji、Mermaid SVG、KaTeX、表格、代码高亮、内嵌与本地图片、深浅主题、20,000px 长文档。

## 验收标准

- 与 Electron 基线逐页/逐像素人工验收，无内容缺失、截断、透明背景或字体替换；
- PDF 保留可选择文字和可点击链接；
- PNG/JPG 保留当前最大高度和 JPEG 质量语义；
- 100 页文档不崩溃，有进度、取消和明确错误；
- 新增二进制与依赖后，整体产物仍满足 60% 体积下降预算。

当前完成的是 alpha 可用性 spike。达到以上全部标准并补齐 Windows 数据后，再将本 ADR 更新为正式生产决策。
