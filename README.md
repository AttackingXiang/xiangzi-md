# Xiangzi MD

一个所见即所得的 Markdown 编辑器（Typora 风格），基于 **Electron + React + Milkdown(Crepe)**。

定位为「复合型文档软件」：打开单个 `.md` 文件只是其中一个功能，同时支持打开整个文件夹、在侧边栏浏览、多标签页编辑。

## 功能

- 📝 **所见即所得编辑**：边写边渲染，基于 ProseMirror 内核，无损读写 Markdown
- 📂 **打开文件夹**：左侧文件树浏览，点击即开
- 🗂 **多标签页**：同时编辑多个文档，未保存有圆点提示
- 🔄 **源码 / 所见即所得切换**（`Cmd/Ctrl + /`）
- 💾 **保存 / 另存为**，新建文件
- 🌗 跟随系统的浅色 / 深色主题
- ⌨️ 原生菜单与快捷键

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
| 切换侧边栏 | `Cmd/Ctrl + B` |
| 切换源码模式 | `Cmd/Ctrl + /` |

## 后续可扩展方向

- 文件树右键菜单（新建 / 重命名 / 删除，IPC 已就绪）
- 大纲视图、全文搜索
- 自动保存、最近文件
- 导出 PDF / HTML
- 图片粘贴自动落盘
