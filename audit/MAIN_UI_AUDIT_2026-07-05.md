# Main UI audit — 2026-07-05

Evidence reviewed:

- Before: `qa-native-final-crop.png`
- Final workspace: `qa-native-controls-final-crop.png`
- Final appearance settings: `qa-appearance-settings-final.png`
- Final controls settings: `qa-controls-settings-final.png`

## Findings and resolution

- P1 — macOS window controls looked custom and did not match platform behavior. Resolved with the native overlay title bar and system traffic lights. Windows keeps the frameless title bar with controls aligned right.
- P1 — source and reading controls competed with document tabs in the upper-right corner. Resolved by moving both controls to a fixed bottom-right action group.
- P1 — the sidebar file tree did not expose reliable vertical or horizontal overflow. Resolved with one two-axis scroll container and content-sized tree rows.
- P1 — range tracks changed apparent width as their value labels changed. Resolved with fixed grid columns, tabular numeric labels, and a larger stable pointer target.
- P2 — “Theme shade” did not explain its direction. Resolved with explicit darker/lighter value labels and helper copy: left darkens the theme surface, right brightens it, independently of background-image intensity.
- P2 — workspace control visibility could not be configured. Resolved with a dedicated Controls page. Path, reading-mode, and source-mode options are disabled whenever the bottom bar is hidden.
- P2 — heading formatting stopped at H3 in visible controls. Resolved with H1–H6 in both the toolbar and editor context menu, plus selection-aware promote/demote actions.
- P2 — the editor, sidebar, tabs, title bar, and status bar used visibly different background layers. Resolved by using shared workspace surface and divider tokens.

## Accessibility and interaction notes

- Native traffic lights expose standard close, minimize, and zoom actions to macOS accessibility APIs.
- Bottom view buttons expose pressed state and accessible labels.
- Disabled dependent toggles are reported as disabled by the accessibility tree.
- At H1, Promote heading is disabled while Demote heading remains available; the opposite boundary is enforced at H6.
- Screenshot review cannot prove every keyboard and assistive-technology path; automated tests and native accessibility-tree checks cover the changed controls.

No actionable P0 or P1 finding remains in the tested state.
