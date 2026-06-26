# Xiangzi MD

一个所见即所得的 Markdown 编辑器，基于 **Electron + React + Milkdown(Crepe)**。

定位为「复合型文档软件」：打开单个 `.md` 文件只是其中一个功能，同时支持打开整个文件夹、在侧边栏浏览、多标签页编辑。

## 下载

前往 **[Releases 页面](https://github.com/AttackingXiang/xiangzi-md/releases/latest)** 下载：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| macOS（Intel + Apple Silicon 通用） | `Xiangzi-MD-*.dmg` | 打开后拖入「应用程序」 |
| Windows | `Xiangzi-MD-Setup-*.exe` | 安装版（NSIS） |
| Windows | `Xiangzi-MD-*-portable.exe` | 便携版，免安装直接运行 |

### 首次打开（绕过系统安全提示）

安装包暂未做代码签名，首次打开系统会提示"无法验证开发者"，按下面操作一次即可，之后正常打开。

**macOS**

1. 把 `.dmg` 里的 **Xiangzi MD** 拖入「应用程序」。
2. 在「应用程序」里 **右键（或 Control+点按）图标 →「打开」**。
3. 弹窗里再点一次 **「打开」**。（只需第一次这样做）
4. 若仍打不开：系统设置 →「隐私与安全性」→ 找到被拦截的提示，点 **「仍要打开」**。
5. 个别情况下可在终端执行：`xattr -dr com.apple.quarantine "/Applications/Xiangzi MD.app"`。

**Windows**

1. 双击安装版 `...Setup.exe` 或便携版 `...portable.exe`。
2. 若出现蓝色窗口 **"Windows 已保护你的电脑 / Windows protected your PC"**，点 **「更多信息 / More info」**。
3. 再点下方出现的 **「仍要运行 / Run anyway」**。（只需第一次）

<details>
<summary>English</summary>

The installers are not code-signed yet, so the OS shows a warning on first launch. Do this once, then it opens normally.

**macOS**

1. Drag **Xiangzi MD** from the `.dmg` into **Applications**.
2. In Applications, **right-click (or Control-click) the icon → Open**.
3. Click **Open** again in the dialog. (First launch only.)
4. If still blocked: System Settings → **Privacy & Security** → click **Open Anyway** next to the blocked message.
5. As a last resort, run in Terminal: `xattr -dr com.apple.quarantine "/Applications/Xiangzi MD.app"`.

**Windows**

1. Run the installer (`...Setup.exe`) or the portable build (`...portable.exe`).
2. If a blue **"Windows protected your PC"** dialog appears, click **More info**.
3. Then click **Run anyway**. (First launch only.)

</details>

> 维护者发布新版本：`git tag v0.1.4 && git push origin v0.1.4`，GitHub Actions 会自动在 macOS / Windows 构建安装包并**自动发布**到 Releases（无需手动操作）。

## 功能

- 📝 **所见即所得编辑**：边写边渲染，基于 ProseMirror 内核，无损读写 Markdown
- 📂 **打开文件夹**：左侧文件树浏览，点击即开
- 🗂 **多标签页**：同时编辑多个文档，未保存有圆点提示
- 🖼 **本地图片**：自定义 `xmd://` 协议渲染；粘贴/拖入自动存到附件目录（Obsidian 风格）
- 🕘 **历史记录**：最近文件 / 最近文件夹（欢迎页快速重开）
- ⭐ **收藏常用目录**：侧边栏一键置顶常用文件夹
- 🧭 **大纲面板**：标题导航，点击跳转（`Cmd/Ctrl + Shift + K`）
- 🔍 **查找替换**：所见即所得内高亮替换，源码模式原生查找（`Cmd/Ctrl + F`）
- 🧜 **Mermaid 流程图**：代码块预览渲染
- 🔄 **源码 / 所见即所得切换**（`Cmd/Ctrl + /`）
- 🎯 **专注模式**（`Cmd/Ctrl + Shift + F`）/ **打字机模式**（`Cmd/Ctrl + Shift + T`）
- 🗂 **文件树右键菜单**：新建 / 重命名 / 删除 / 在访达中显示
- ↔️ **可调显示宽度**（适中 / 较宽 / 全宽）
- 💾 **保存 / 另存为 / 自动保存**，📤 **导出 PDF / HTML**
- 🌗 **主题**：跟随系统 / 浅色 / 深色，支持加载**自定义 CSS 主题**
- 🎨 现代简洁 UI（Lucide 图标），⌨️ 原生菜单与快捷键

## 开发环境

使用 [mise](https://mise.jdx.dev/) 固定 Node 版本（见 `mise.toml`，Node 22）。

```bash
mise install        # 安装 Node 22
mise exec -- npm install
```

也可用 mise 任务：

```bash
mise run dev        # 开发模式（热更新）
mise run build      # 构建
mise run start      # 预览构建产物
mise run dist       # 打包为桌面应用（macOS dmg）
```

或直接用 npm：

```bash
npm run dev
npm run build
npm run dist
```

## 项目结构

```
src/
  main/            # Electron 主进程
    index.ts       #   窗口与生命周期
    ipc.ts         #   文件系统 IPC（打开/读写/重命名/删除）
    menu.ts        #   原生应用菜单
  preload/         # 预加载脚本（contextBridge 暴露安全 API）
  renderer/        # React 渲染层
    src/
      App.tsx      #   状态编排：文件夹 / 标签页 / 保存
      components/
        Editor.tsx        # Milkdown Crepe 所见即所得编辑器
        SourceEditor.tsx  # 源码模式
        Sidebar.tsx       # 侧边栏
        FileTree.tsx      # 文件树
        TabBar.tsx        # 标签栏
        Welcome.tsx       # 欢迎页
        StatusBar.tsx     # 状态栏（字数统计）
```

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建文件 | `Cmd/Ctrl + N` |
| 打开文件 | `Cmd/Ctrl + O` |
| 打开文件夹 | `Cmd/Ctrl + Shift + O` |
| 保存 | `Cmd/Ctrl + S` |
| 另存为 | `Cmd/Ctrl + Shift + S` |
| 关闭标签页 | `Cmd/Ctrl + W` |
| 查找 | `Cmd/Ctrl + F` |
| 切换侧边栏 | `Cmd/Ctrl + \` |
| 大纲 | `Cmd/Ctrl + Shift + K` |
| 切换源码模式 | `Cmd/Ctrl + /` |
| 快捷键面板 | `Cmd/Ctrl + Shift + /` |
| 设置 | `Cmd/Ctrl + ,` |

编辑类（编辑器聚焦时）：

| 操作 | 快捷键 |
| --- | --- |
| 一~六级标题 | `Cmd/Ctrl + 1…6`（备用 `Cmd/Ctrl + Alt + 1…6`） |
| 设为正文 | `Cmd/Ctrl + 0` |
| 加粗 / 斜体 / 行内代码 | `Cmd/Ctrl + B / I / E` |
| 引用 / 代码块 | `Cmd/Ctrl + Shift + B` / `Cmd/Ctrl + Alt + C` |
| 无序 / 有序列表 | `Cmd/Ctrl + Alt + 8 / 7` |

> 完整列表见应用内「视图 → 快捷键」面板。

## 后续可扩展方向

- 文件树右键菜单（新建 / 重命名 / 删除，IPC 已就绪）
- 大纲视图、全文搜索
- 自动保存、最近文件
- 导出 PDF / HTML
- 图片粘贴自动落盘
