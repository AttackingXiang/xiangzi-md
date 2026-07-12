# Design QA

- Reference state: `qa-native-final-crop.png`
- Final workspace: `qa-native-controls-final-crop.png`
- Final appearance settings: `qa-appearance-settings-final.png`
- Final controls settings: `qa-controls-settings-final.png`
- Final heading selection toolbar: `qa-heading-selection-toolbar.png`
- Final heading shortcut settings: `qa-heading-shortcuts-settings.png`
- Platform: macOS, native Tauri debug bundle
- State: light theme, theme shade 0, background intensity 30%, code-block opacity 30%

## Visual comparison

The original and final workspace states were inspected at the same application size. The final build keeps the existing typography and violet accent while replacing the custom macOS controls with native traffic lights, reducing upper-right toolbar density, moving view controls to the fixed bottom-right edge, and keeping the background material continuous across title bar, file tree, editor, and status bar.

The appearance page was inspected after setting both requested opacity values to 30%. All range tracks retain the same measured width as labels change. Theme shade now displays a stable direction label and explains that negative values darken the theme surface while positive values brighten it.

## Interaction evidence

- Native close, minimize, and zoom controls are exposed by macOS.
- Bottom reading/source buttons expose accessible pressed state and toggle successfully.
- H1–H6 are present in the editor toolbar and right-click menu.
- Right-clicking H1 disables Promote and enables Demote; heading-level calculations are unit tested at H1/H6 boundaries.
- Selecting heading text adds Promote/Demote to Crepe's native floating toolbar. H1 disables Promote, H6 disables Demote, and non-heading selections hide both controls and their divider.
- `Cmd/Ctrl+Alt+ArrowUp` and `Cmd/Ctrl+Alt+ArrowDown` promote/demote headings and are visible and editable in shortcut settings.
- Backspace at the start of H1-H6 clears the heading directly to paragraph in one action; native H6 testing confirmed it no longer walks through intermediate levels.
- Turning off the bottom bar immediately hides it and disables the path/reading/source visibility toggles; restoring it re-enables all three.
- The file tree scrolls vertically after expanding nested folders and uses one two-axis overflow container for long paths.

## Verification

- Frontend: format, lint, TypeScript, 129 Vitest tests, production build — passed.
- Native: Rust formatting, 50 tests, Clippy with warnings denied — passed.
- Packaging: macOS debug `.app` bundle with the platform overlay configuration — passed.

final result: passed
