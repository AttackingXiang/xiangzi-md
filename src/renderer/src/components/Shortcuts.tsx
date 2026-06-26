import { X } from 'lucide-react'

interface Props {
  onClose: () => void
}

const isMac = navigator.platform.toLowerCase().includes('mac')
const MOD = isMac ? '⌘' : 'Ctrl'
const ALT = isMac ? '⌥' : 'Alt'
const SHIFT = isMac ? '⇧' : 'Shift'

interface Item {
  label: string
  keys: string[]
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: '文件',
    items: [
      { label: '新建文件', keys: [MOD, 'N'] },
      { label: '打开文件', keys: [MOD, 'O'] },
      { label: '打开文件夹', keys: [MOD, SHIFT, 'O'] },
      { label: '保存', keys: [MOD, 'S'] },
      { label: '另存为', keys: [MOD, SHIFT, 'S'] },
      { label: '关闭标签页', keys: [MOD, 'W'] }
    ]
  },
  {
    title: '视图',
    items: [
      { label: '切换侧边栏', keys: [MOD, '\\'] },
      { label: '大纲', keys: [MOD, SHIFT, 'K'] },
      { label: '源码 / 所见即所得', keys: [MOD, '/'] },
      { label: '查找', keys: [MOD, 'F'] },
      { label: '设置', keys: [MOD, ','] }
    ]
  },
  {
    title: '标题与段落',
    items: [
      { label: '一级 ~ 六级标题', keys: [MOD, '1 … 6'] },
      { label: '标题（备用键位）', keys: [MOD, ALT, '1 … 6'] },
      { label: '设为正文', keys: [MOD, '0'] }
    ]
  },
  {
    title: '文本格式',
    items: [
      { label: '加粗', keys: [MOD, 'B'] },
      { label: '斜体', keys: [MOD, 'I'] },
      { label: '行内代码', keys: [MOD, 'E'] }
    ]
  },
  {
    title: '块与列表',
    items: [
      { label: '引用', keys: [MOD, SHIFT, 'B'] },
      { label: '代码块', keys: [MOD, ALT, 'C'] },
      { label: '无序列表', keys: [MOD, ALT, '8'] },
      { label: '有序列表', keys: [MOD, ALT, '7'] },
      { label: '列表缩进', keys: ['Tab'] },
      { label: '列表反缩进', keys: [SHIFT, 'Tab'] },
      { label: '软换行', keys: [SHIFT, 'Enter'] }
    ]
  }
]

export default function Shortcuts({ onClose }: Props): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>快捷键</span>
          <button className="icon-btn sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="sc-grid">
            {GROUPS.map((g) => (
              <section key={g.title} className="sc-group">
                <h3>{g.title}</h3>
                {g.items.map((it) => (
                  <div key={it.label} className="sc-row">
                    <span className="sc-label">{it.label}</span>
                    <span className="sc-keys">
                      {it.keys.map((k, i) => (
                        <kbd key={i}>{k}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <p className="settings-hint">
            标题、加粗、列表等编辑类快捷键在编辑器获得焦点时生效。Markdown
            语法（如输入 <code># </code> 自动成为标题、<code>- </code> 成为列表）同样可用。
          </p>
        </div>
      </div>
    </div>
  )
}
