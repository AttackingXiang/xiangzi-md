import { X } from 'lucide-react'
import { t, getLang } from '../lib/i18n'

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

export default function Shortcuts({ onClose }: Props): JSX.Element {
  const groups: { title: string; items: Item[] }[] = [
    {
      title: t('文件'),
      items: [
        { label: t('新建文件'), keys: [MOD, 'N'] },
        { label: t('打开文件'), keys: [MOD, 'O'] },
        { label: t('打开文件夹'), keys: [MOD, SHIFT, 'O'] },
        { label: t('保存'), keys: [MOD, 'S'] },
        { label: t('另存为'), keys: [MOD, SHIFT, 'S'] },
        { label: t('关闭标签页'), keys: [MOD, 'W'] },
      ],
    },
    {
      title: t('视图'),
      items: [
        { label: t('切换侧边栏'), keys: [MOD, '\\'] },
        { label: t('大纲'), keys: [MOD, SHIFT, 'K'] },
        { label: t('源码 / 所见即所得'), keys: [MOD, '/'] },
        { label: t('查找'), keys: [MOD, 'F'] },
        { label: t('在文件夹中搜索'), keys: [MOD, SHIFT, 'F'] },
        { label: t('命令面板'), keys: [MOD, 'K'] },
        { label: t('设置'), keys: [MOD, ','] },
      ],
    },
    {
      title: t('标题与段落'),
      items: [
        { label: t('一级 ~ 六级标题'), keys: [MOD, '1 … 6'] },
        { label: t('标题（备用键位）'), keys: [MOD, ALT, '1 … 6'] },
        { label: t('设为正文'), keys: [MOD, '0'] },
      ],
    },
    {
      title: t('文本格式'),
      items: [
        { label: t('加粗'), keys: [MOD, 'B'] },
        { label: t('斜体'), keys: [MOD, 'I'] },
        { label: t('行内代码'), keys: [MOD, 'E'] },
      ],
    },
    {
      title: t('块与列表'),
      items: [
        { label: t('引用'), keys: [MOD, SHIFT, 'B'] },
        { label: t('代码块'), keys: [MOD, ALT, 'C'] },
        { label: t('无序列表'), keys: [MOD, ALT, '8'] },
        { label: t('有序列表'), keys: [MOD, ALT, '7'] },
        { label: t('列表缩进'), keys: ['Tab'] },
        { label: t('列表反缩进'), keys: [SHIFT, 'Tab'] },
        { label: t('软换行'), keys: [SHIFT, 'Enter'] },
      ],
    },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('快捷键')}</span>
          <button className="icon-btn sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="sc-grid">
            {groups.map((g) => (
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
            {getLang() === 'en'
              ? 'Editing shortcuts (headings, bold, lists…) work when the editor is focused. Markdown syntax (typing "# " for a heading, "- " for a list) works too.'
              : '标题、加粗、列表等编辑类快捷键在编辑器获得焦点时生效。Markdown 语法（如输入 “# ” 自动成为标题、“- ” 成为列表）同样可用。'}
          </p>
        </div>
      </div>
    </div>
  )
}
