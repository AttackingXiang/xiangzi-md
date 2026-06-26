interface Props {
  onOpenFolder: () => void
  onOpenFile: () => void
  onNewFile: () => void
}

export default function Welcome({ onOpenFolder, onOpenFile, onNewFile }: Props): JSX.Element {
  return (
    <div className="welcome">
      <h1>Xiangzi MD</h1>
      <p className="welcome-sub">所见即所得的 Markdown 编辑器</p>
      <div className="welcome-actions">
        <button className="primary-btn" onClick={onNewFile}>
          新建文件
        </button>
        <button className="secondary-btn" onClick={onOpenFile}>
          打开文件
        </button>
        <button className="secondary-btn" onClick={onOpenFolder}>
          打开文件夹
        </button>
      </div>
      <ul className="welcome-tips">
        <li>
          <kbd>⌘/Ctrl</kbd> + <kbd>N</kbd> 新建　<kbd>⌘/Ctrl</kbd> + <kbd>O</kbd> 打开文件
        </li>
        <li>
          <kbd>⌘/Ctrl</kbd> + <kbd>S</kbd> 保存　<kbd>⌘/Ctrl</kbd> + <kbd>B</kbd> 侧边栏
        </li>
        <li>
          <kbd>⌘/Ctrl</kbd> + <kbd>/</kbd> 切换源码 / 所见即所得
        </li>
      </ul>
    </div>
  )
}
