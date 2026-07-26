interface Props {
  lang: 'zh' | 'en'
  kind: 'text' | 'highlight'
  initialColor: string
  onSelect: (color: string) => void
}

export default function CustomColorSwatch({
  lang,
  kind,
  initialColor,
  onSelect,
}: Props): JSX.Element {
  const label =
    lang === 'en'
      ? kind === 'text'
        ? 'Custom text color'
        : 'Custom highlight color'
      : kind === 'text'
        ? '自定义文字颜色'
        : '自定义荧光笔颜色'

  return (
    <label
      className="custom-color-swatch"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
    >
      <input
        type="color"
        defaultValue={initialColor}
        aria-label={label}
        onChange={(event) => onSelect(event.currentTarget.value)}
      />
    </label>
  )
}
