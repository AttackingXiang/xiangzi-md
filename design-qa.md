# Design QA

- Source visual truth: `/var/folders/ld/t1wc9y1x5cjfhkqjqxjfhgwc0000gn/T/codex-clipboard-db7cd3a3-2a97-437b-956c-c511bd782ea1.png`
- Implementation screenshot: `/tmp/xiangzi-md-list-compact-final-clean.png`
- Viewport: 1200 × 800 logical pixels, macOS Retina capture at 2×
- State: light theme, WYSIWYG mode, H1 plus ordered and unordered lists

## Full-view comparison evidence

The source and implementation were opened together in one comparison input. The source shows ordered-list labels above the first text line and roughly one empty text line between adjacent items. In the implementation, ordered labels and bullet centers follow the first 25.6px line box, while adjacent items now flow at normal text rhythm without the duplicated paragraph margins. Heading hierarchy, divider, body width, colors, and the intended Typora-like styling remain consistent.

## Focused-region comparison evidence

The source image already isolates the title and list region, so no additional crop was required. At the focused list region, `1.`–`4.` and both bullet dots are optically centered against their corresponding first text line. The wrapped first item retains its internal 1.6 line height, while subsequent single-line rows no longer inherit normal paragraph top and bottom margins.

## Findings

- No actionable P0, P1, or P2 typography findings remain in the tested state.
- No image assets are present in this comparison state.
- App copy and sidebar labels are unchanged by this patch.

## Patches made

- Replaced WebView-dependent HTML5 file-tree drag/drop with cross-platform pointer-event drag/drop.
- Targeted Crepe's actual `[data-content-dom]` wrapper so list paragraphs receive zero vertical margins and padding.
- Matched ordered, unordered, and task-list marker boxes to the 25.6px list text line without a compensating transform.

## Follow-up polish

- P3: verify marker sizing against unusually large custom CSS font sizes if a custom theme overrides the editor typography.

final result: passed
