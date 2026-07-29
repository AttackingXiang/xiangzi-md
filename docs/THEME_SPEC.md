# Xiangzi MD Theme Specification v1

Xiangzi MD themes are CSS files loaded after the built-in application styles. Theme contract v1
uses public `--xmd-*` custom properties for normal customization and stable `.xmd-*` selectors for
advanced layout. A theme must not depend on generated CodeMirror classes such as `.ͼ1`.

The canonical defaults live in `src/styles/slices/theme-contract.css`. A missing property always
falls back to the active built-in theme, so a theme may override only the values it needs.

## Install and test

1. Open Settings > Appearance > Custom theme CSS.
2. Select the theme CSS file.
3. Test light and dark built-in bases, narrow windows, source mode, reading mode, HTML/PDF export,
   long code blocks, wide tables, KaTeX, and Mermaid.

Contract v1 currently loads one CSS file; adjacent relative assets are not resolved from the CSS
file's directory. Use system fonts or embedded `data:` URLs. Use WOFF2 for embedded fonts, keep
assets small, and do not load remote URLs. A future packaged-theme installer can add managed local
assets without changing the v1 rendering variables.

## Contract rules

- Contract version: `1`.
- Public custom properties and selectors start with `--xmd-` and `.xmd-`.
- Properties without that prefix are legacy/internal and may change.
- Themes are presentation only. They cannot execute JavaScript or add editor commands.
- Do not hide editable content, selection layers, cursors, or accessibility labels.
- Keep text/background contrast readable and preserve visible keyboard focus.
- HTML, PDF, and image exports use the same renderer and theme CSS. DOCX export has its own style
  model and does not guarantee theme parity.

## Variables

### Document and headings

| Variable | Purpose |
| --- | --- |
| `--xmd-font-body`, `--xmd-font-heading`, `--xmd-font-code` | Body, heading, and code font stacks |
| `--xmd-document-text`, `--xmd-document-secondary`, `--xmd-document-muted` | Text hierarchy |
| `--xmd-document-accent`, `--xmd-document-selection-bg` | Accent and selection |
| `--xmd-document-line-height` | Body line height |
| `--xmd-paragraph-spacing`, `--xmd-paragraph-separated-spacing` | Paragraph rhythm |
| `--xmd-heading-color`, `--xmd-heading-font`, `--xmd-heading-weight` | Shared heading defaults |
| `--xmd-heading-1-color` through `--xmd-heading-6-color` | Per-level colors |
| `--xmd-heading-1-size` through `--xmd-heading-6-size` | Desktop heading sizes |
| `--xmd-heading-1-size-mobile`, `--xmd-heading-2-size-mobile` | Narrow-window sizes |
| `--xmd-heading-1-weight` through `--xmd-heading-6-weight` | Per-level weights |
| `--xmd-heading-1-style` through `--xmd-heading-6-style` | Per-level font styles |
| `--xmd-heading-1-border-bottom`, `--xmd-heading-2-border-left` | Common decorative rules |
| `--xmd-heading-1-padding-bottom`, `--xmd-heading-2-padding-left` | Space for decorative rules |
| `--xmd-heading-number-color` | Automatic heading-number color |

### Inline content and blocks

| Variable | Purpose |
| --- | --- |
| `--xmd-strong-weight`, `--xmd-emphasis-style`, `--xmd-strikethrough-color` | Emphasis |
| `--xmd-highlight-bg`, `--xmd-highlight-text`, `--xmd-highlight-radius` | Highlight marks |
| `--xmd-link-color`, `--xmd-link-decoration` | Links |
| `--xmd-inline-code-bg`, `--xmd-inline-code-text` | Inline code colors |
| `--xmd-inline-code-border`, `--xmd-inline-code-radius` | Inline code shape |
| `--xmd-horizontal-rule-color`, `--xmd-horizontal-rule-width` | Thematic breaks |
| `--xmd-quote-text`, `--xmd-quote-border`, `--xmd-quote-bg` | Blockquotes |
| `--xmd-list-marker-color` | Ordered and unordered markers |
| `--xmd-task-border`, `--xmd-task-checked-bg`, `--xmd-task-check-color` | Task checkboxes |
| `--xmd-callout-*` | GitHub alerts and Obsidian callouts, including warning, success, example, and quote variants |

### Code

`--xmd-code-bg`, `--xmd-code-border`, `--xmd-code-text`, `--xmd-code-radius`, and
`--xmd-code-selection-bg` style the code card. Syntax tokens use:

```text
--xmd-code-keyword       --xmd-code-string       --xmd-code-comment
--xmd-code-number        --xmd-code-function     --xmd-code-type
--xmd-code-property      --xmd-code-variable     --xmd-code-tag
--xmd-code-operator      --xmd-code-meta         --xmd-code-link
--xmd-code-invalid       --xmd-code-diff-added   --xmd-code-diff-removed
```

These values are shared by editing, rendered code, and export.

### Tables, images, math, and diagrams

| Variable | Purpose |
| --- | --- |
| `--xmd-table-text`, `--xmd-table-border`, `--xmd-table-radius` | Table foundation |
| `--xmd-table-header-bg`, `--xmd-table-header-weight` | Header row |
| `--xmd-table-stripe-bg`, `--xmd-table-hover-bg` | Row and hover states |
| `--xmd-table-active-bg`, `--xmd-table-active-border` | Active editable cell |
| `--xmd-table-cell-padding` | Cell density |
| `--xmd-image-radius`, `--xmd-image-border`, `--xmd-image-shadow` | Rendered images |
| `--xmd-image-caption-color`, `--xmd-image-loading-bg` | Image supporting states |
| `--xmd-math-text`, `--xmd-math-display-bg` | KaTeX text and display surface |
| `--xmd-math-display-border`, `--xmd-math-display-radius` | Display-math container |
| `--xmd-mermaid-bg`, `--xmd-mermaid-border`, `--xmd-mermaid-radius` | Mermaid container |
| `--xmd-diagram-node-bg`, `--xmd-diagram-node-border` | Mermaid nodes |
| `--xmd-diagram-text`, `--xmd-diagram-line`, `--xmd-diagram-label-bg` | Mermaid content |

Rendered copy/edit controls use `--xmd-render-control-*`; success and failure feedback use
`--xmd-status-success` and `--xmd-status-danger`.

## Stable advanced selectors

Use these only when variables cannot express the design:

```css
.xmd-cm-editor .xmd-cm-paragraph {}
.xmd-cm-editor .xmd-cm-heading-1 {}
.xmd-cm-editor .xmd-cm-heading-2 {}
.xmd-cm-editor .xmd-cm-strong {}
.xmd-cm-editor .xmd-cm-emphasis {}
.xmd-cm-editor .xmd-cm-strikethrough {}
.xmd-cm-editor .xmd-cm-inline-code {}
.xmd-cm-editor .xmd-cm-inline-highlight {}
.xmd-cm-editor .xmd-cm-link {}
.xmd-cm-editor .xmd-cm-blockquote {}
.xmd-cm-editor .xmd-cm-callout {}
.xmd-cm-editor .xmd-cm-list-line {}
.xmd-cm-editor .xmd-cm-list-marker {}
.xmd-cm-editor .xmd-cm-task-checkbox {}
.xmd-cm-editor .xmd-cm-code-line {}
.xmd-cm-table-preview table {}
.xmd-cm-table-preview th {}
.xmd-cm-table-preview td {}
.xmd-cm-image-preview img {}
.xmd-cm-math-display {}
.xmd-cm-mermaid-preview {}
```

Do not target `.cm-line` by itself: that would also affect source and widget rows. Scope advanced
rules below `.xmd-cm-editor` unless the documented selector is a top-level preview widget.

## Minimal theme

```css
:root {
  --xmd-document-text: #30332f;
  --xmd-document-accent: #657a6a;
  --xmd-heading-1-color: #826b5e;
  --xmd-code-bg: #f1eeea;
  --xmd-table-header-bg: #e8eeea;
  --xmd-diagram-node-bg: #e2e8e3;
}
```

See `docs/examples/themes/morandi.css` for a complete example covering every rendering category.
