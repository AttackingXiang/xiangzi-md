import { useState } from 'react'
import { Bold, Code, Italic, Link, Palette, Strikethrough } from 'lucide-react'
import { editorCmd } from '../lib/editorCommands'
import TextColorPalette from './TextColorPalette'

export interface SelectionToolbarAnchor {
  left: number
  top: number
  below: boolean
}

interface Props {
  anchor: SelectionToolbarAnchor
  lang: 'zh' | 'en'
}

export default function SelectionToolbar({ anchor, lang }: Props): JSX.Element {
  const [showColors, setShowColors] = useState(false)
  const label = (zh: string, en: string): string => (lang === 'en' ? en : zh)
  const actions = [
    { label: label('加粗', 'Bold'), icon: <Bold size={14} />, run: editorCmd.bold },
    { label: label('斜体', 'Italic'), icon: <Italic size={14} />, run: editorCmd.italic },
    {
      label: label('删除线', 'Strikethrough'),
      icon: <Strikethrough size={14} />,
      run: editorCmd.strike,
    },
    {
      label: label('行内代码', 'Inline code'),
      icon: <Code size={14} />,
      run: editorCmd.inlineCode,
    },
    { label: label('链接', 'Link'), icon: <Link size={14} />, run: editorCmd.insertLink },
  ]

  return (
    <div
      className={`selection-toolbar${anchor.below ? ' is-below' : ''}`}
      role="toolbar"
      aria-label={label('选中文本快捷工具栏', 'Selection toolbar')}
      style={{ left: anchor.left, top: anchor.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          type="button"
          key={action.label}
          className="selection-toolbar-btn"
          title={action.label}
          aria-label={action.label}
          onClick={action.run}
        >
          {action.icon}
        </button>
      ))}
      <span className="selection-toolbar-sep" />
      <button
        type="button"
        className={`selection-toolbar-btn${showColors ? ' is-active' : ''}`}
        title={label('文字颜色', 'Text color')}
        aria-label={label('文字颜色', 'Text color')}
        aria-expanded={showColors}
        onClick={() => setShowColors((visible) => !visible)}
      >
        <Palette size={14} />
      </button>
      {showColors && (
        <div className="selection-color-popover">
          <TextColorPalette
            lang={lang}
            onSelect={(color) => {
              editorCmd.textColor(color)
              setShowColors(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
