import { X } from 'lucide-react'
import CustomColorSwatch from './CustomColorSwatch'
import { DEFAULT_TEXT_COLOR_PRESETS } from '../lib/colorPresets'

interface Props {
  lang: 'zh' | 'en'
  colors?: readonly string[]
  defaultColor?: string
  onSelect: (color: string | null) => void
}

export default function TextColorPalette({
  lang,
  colors = DEFAULT_TEXT_COLOR_PRESETS,
  defaultColor = colors[0] ?? '#dc2626',
  onSelect,
}: Props): JSX.Element {
  const cancelLabel = lang === 'en' ? 'Cancel text color' : '取消文字颜色'
  return (
    <div
      className="text-color-palette"
      role="group"
      aria-label={lang === 'en' ? 'Text colors' : '文字颜色'}
    >
      {colors.map((color) => (
        <button
          type="button"
          key={color}
          className="text-color-swatch"
          style={{ '--xmd-text-color': color } as React.CSSProperties}
          title={color}
          aria-label={`${lang === 'en' ? 'Text color' : '文字颜色'} ${color}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(color)}
        />
      ))}
      <CustomColorSwatch lang={lang} kind="text" initialColor={defaultColor} onSelect={onSelect} />
      <button
        type="button"
        className="text-color-reset"
        title={cancelLabel}
        aria-label={cancelLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(null)}
      >
        <X size={14} />
      </button>
    </div>
  )
}
