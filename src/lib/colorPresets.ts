/** Mirrors MAX_COLOR_PRESETS in src-tauri/src/infrastructure/settings_model.rs. */
export const MAX_COLOR_PRESETS = 24

export const DEFAULT_TEXT_COLOR_PRESETS = [
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
export const DEFAULT_HIGHLIGHT_COLOR_PRESETS = [
  '#fde047',
  '#fdba74',
  '#fda4af',
  '#f0abfc',
  '#c4b5fd',
  '#93c5fd',
  '#67e8f9',
  '#6ee7b7',
  '#bef264',
  '#d1d5db',
] as const
export const normalizeHexColor = (color: string): string | null => {
  const value = color.trim().toLowerCase()
  return /^#[\da-f]{6}$/.test(value) ? value : null
}
