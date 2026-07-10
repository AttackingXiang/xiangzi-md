# 使用说明重写测试发现问题清单

测试版本：Xiangzi MD 1.6.7

测试日期：2026-07-11

测试目录：`/tmp/xiangzi-md-user-guide-sandbox`

## 已复核：macOS 开发态启动问题（此前一次性复现）

现象：

- 首次测试时，执行 `npm run tauri:dev` 后，Vite 成功启动，Rust 编译成功，输出 `Running target/debug/xiangzi-md`，随后进程退出，没有可见窗口。
- 用户随后复测同一命令，确认可以正常打开窗口；因此当前无法判定为稳定缺陷。
- 直接执行 `./src-tauri/target/debug/xiangzi-md`，退出码为 0，无窗口、无终端错误。
- 执行 `open 'src-tauri/target/debug/bundle/macos/Xiangzi MD.app'` 后，进程短暂出现并变成 `(xiangzi-md)` 僵尸进程，没有可见窗口。

影响：

- 首次测试阶段无法完成最新版真实界面截图；问题复测通过后，应继续补拍并逐项点击验证。

已排除：

- 1420 端口占用：清理旧 `tauri dev` / Vite 进程后重新启动，问题仍存在。
- 单独前端服务：Vite 可正常启动。

关联线索：

- macOS 诊断报告中存在旧版 `xiangzi-md` 崩溃记录，异常为 `EXC_CRASH / SIGABRT`，栈中出现 `tao::platform_impl::platform::app_delegate::did_finish_launching`。
- 该崩溃记录版本为 1.6.2，不是本次 1.6.7 新生成报告，但阶段与现象接近。

建议（仅在问题再次出现时）：

1. 在 Tauri setup / window creation / menu install 前后加日志。
2. 临时移除或降级验证 `tauri-plugin-single-instance`、自定义无边框窗口、菜单安装逻辑。
3. 使用 `RUST_BACKTRACE=1`、`RUST_LOG=trace` 和 macOS Console 同步采集新崩溃日志。
4. 在另一台 macOS 或 CI 打包产物上确认是否复现。

## P1：浏览器直接打开 Vite 页面为空白

现象：

- 打开 `http://127.0.0.1:1420/` 时页面只显示标题区域，控制台报错：
  - `Cannot read properties of undefined (reading 'invoke')`
  - `Cannot read properties of undefined (reading 'transformCallback')`

原因：

- React 前端直接依赖 Tauri IPC；普通浏览器环境没有 `window.__TAURI_INTERNALS__`。

影响：

- 不能用普通浏览器作为截图替代方案。

建议：

- 如果希望前端可单独预览，可增加 mock desktop adapter 或检测非 Tauri 环境后显示开发提示页。

## P2：文档中仍有旧截图引用

现象：

- 旧 `docs/USER_GUIDE.md` 引用了 `images/user-guide/*.png`。
- 当前无法确认这些截图是否对应 1.6.7。

处理：

- 本次已重写正文并移除旧截图引用。
- 待 P0 修复后按清单补拍 1.6.7 最新截图。
