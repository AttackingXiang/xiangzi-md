import { X } from 'lucide-react'
import CustomColorSwatch from './CustomColorSwatch'
import { DEFAULT_HIGHLIGHT_COLOR_PRESETS } from '../lib/colorPresets'
import { t } from '../lib/i18n'

interface Props {
  lang: 'zh' | 'en'
  colors?: readonly string[]
  defaultColor?: string
  onSelect: (color: string | null) => void
}

export default function HighlightColorPalette({
  lang,
  colors = DEFAULT_HIGHLIGHT_COLOR_PRESETS,
  defaultColor = colors[0] ?? '#fde047',
  onSelect,
}: Props): JSX.Element {
  const cancelLabel = t('取消荧光笔')
  return (
    <div
      className="text-color-palette highlight-color-palette"
      role="group"
      aria-label={t('荧光笔颜色')}
    >
      {colors.map((color) => (
        <button
          type="button"
          key={color}
          className="text-color-swatch highlight-color-swatch"
          style={{ '--xmd-highlight-color': color } as React.CSSProperties}
          title={color}
          aria-label={`${t('荧光笔颜色')} ${color}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(color)}
        />
      ))}
      <CustomColorSwatch
        lang={lang}
        kind="highlight"
        initialColor={defaultColor}
        onSelect={onSelect}
      />
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
