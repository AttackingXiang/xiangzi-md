import { RotateCcw } from 'lucide-react'

const TEXT_COLOR_OPTIONS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
  '#db2777',
  '#64748b',
] as const

interface Props {
  lang: 'zh' | 'en'
  onSelect: (color: string | null) => void
}

export default function TextColorPalette({ lang, onSelect }: Props): JSX.Element {
  const resetLabel = lang === 'en' ? 'Remove text color' : '移除文字颜色'
  return (
    <div
      className="text-color-palette"
      role="group"
      aria-label={lang === 'en' ? 'Text colors' : '文字颜色'}
    >
      {TEXT_COLOR_OPTIONS.map((color) => (
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
      <button
        type="button"
        className="text-color-reset"
        title={resetLabel}
        aria-label={resetLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(null)}
      >
        <RotateCcw size={13} />
      </button>
    </div>
  )
}
