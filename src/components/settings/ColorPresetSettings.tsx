import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { AppSettings } from '../../types'
import { MAX_COLOR_PRESETS, normalizeHexColor } from '../../lib/colorPresets'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
}

export default function ColorPresetSettings({ settings, onChange, en }: Props): JSX.Element {
  const [textDraft, setTextDraft] = useState(settings.defaultTextColor)
  const [highlightDraft, setHighlightDraft] = useState(settings.defaultHighlightColor)

  const editor = (
    kind: 'text' | 'highlight',
    colors: string[],
    selected: string,
    draft: string,
    setDraft: (value: string) => void,
  ): JSX.Element => {
    const listKey = kind === 'text' ? 'textColorPresets' : 'highlightColorPresets'
    const defaultKey = kind === 'text' ? 'defaultTextColor' : 'defaultHighlightColor'
    const save = (next: string[], nextDefault: string): void =>
      onChange({ [listKey]: next, [defaultKey]: nextDefault })
    const add = (): void => {
      const color = normalizeHexColor(draft)
      if (!color) return
      if (!colors.includes(color) && colors.length >= MAX_COLOR_PRESETS) return
      const next = colors.includes(color) ? colors : [...colors, color].slice(0, MAX_COLOR_PRESETS)
      save(next, color)
      setDraft(color)
    }
    return (
      <div className="color-preset-editor">
        <div className="color-preset-title">
          {kind === 'text'
            ? en
              ? 'Text colors'
              : '文字颜色'
            : en
              ? 'Highlighter colors'
              : '荧光笔颜色'}
          <small>{en ? 'Click a color to make it the default.' : '点击颜色设为默认色。'}</small>
        </div>
        <div className="color-preset-list">
          {colors.map((color) => (
            <span
              key={color}
              className={`color-preset-item${color === selected ? ' is-default' : ''}`}
            >
              <button
                className="color-preset-swatch"
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`${color}${color === selected ? (en ? ' default' : ' 默认') : ''}`}
                onClick={() => save(colors, color)}
              />
              <button
                className="color-preset-remove"
                aria-label={`${en ? 'Remove' : '删除'} ${color}`}
                disabled={colors.length <= 1}
                onClick={() => {
                  const next = colors.filter((item) => item !== color)
                  save(next, color === selected ? (next[0] ?? selected) : selected)
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="color-preset-add">
          <input
            type="color"
            value={draft}
            aria-label={en ? 'Choose color' : '选择颜色'}
            onChange={(event) => setDraft(event.target.value)}
          />
          <input
            value={draft}
            aria-label={en ? 'Color value' : '颜色值'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
          />
          <button
            onClick={add}
            disabled={
              normalizeHexColor(draft) === null ||
              (!colors.includes(normalizeHexColor(draft) ?? '') &&
                colors.length >= MAX_COLOR_PRESETS)
            }
          >
            <Plus size={13} />
            {en ? 'Add and set default' : '添加并设为默认'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="color-preset-settings">
      {editor(
        'text',
        settings.textColorPresets,
        settings.defaultTextColor,
        textDraft,
        setTextDraft,
      )}
      {editor(
        'highlight',
        settings.highlightColorPresets,
        settings.defaultHighlightColor,
        highlightDraft,
        setHighlightDraft,
      )}
    </div>
  )
}
