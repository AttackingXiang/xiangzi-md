import type { SearchFocusEffect } from '../types'

export interface SearchFocusEffectPreset {
  animation: string
  duration: string
  label: { zh: string; en: string }
  description: { zh: string; en: string }
}

/**
 * Search focus effects are deliberately data-driven. A theme can replace the
 * CSS keyframes, while settings only select from safe, known presets.
 */
export const SEARCH_FOCUS_EFFECT_PRESETS: Record<SearchFocusEffect, SearchFocusEffectPreset> = {
  off: {
    animation: 'none',
    duration: '0ms',
    label: { zh: '关闭动画', en: 'Off' },
    description: {
      zh: '保留静态高亮，不播放额外动画。',
      en: 'Keep the static highlight without an extra animation.',
    },
  },
  sparkle: {
    animation: 'xmd-focus-sparkle',
    duration: '860ms',
    label: { zh: '星光闪烁（推荐）', en: 'Sparkle (recommended)' },
    description: {
      zh: '轻量的放大、闪光和小星星提示。',
      en: 'A subtle scale, glow, and star cue.',
    },
  },
  ring: {
    animation: 'xmd-focus-ring',
    duration: '760ms',
    label: { zh: '聚焦扩散圈', en: 'Focus ring' },
    description: {
      zh: '从命中内容向外扩散一圈，比较克制。',
      en: 'A restrained ring that expands from the match.',
    },
  },
  confetti: {
    animation: 'xmd-focus-confetti',
    duration: '1100ms',
    label: { zh: '完结撒花（夸张）', en: 'Confetti finale' },
    description: {
      zh: '较大的庆祝动画，约占 5×5 个字符的视觉范围。',
      en: 'A large celebration cue, roughly a 5×5-character footprint.',
    },
  },
  shatter: {
    animation: 'xmd-focus-shatter',
    duration: '900ms',
    label: { zh: '碎片散开', en: 'Shatter' },
    description: {
      zh: '像碎片散开的趣味提示，仍不改变正文布局。',
      en: 'A playful shattering cue that never changes document layout.',
    },
  },
}

export const DEFAULT_SEARCH_FOCUS_EFFECT: SearchFocusEffect = 'sparkle'

export function normalizeSearchFocusEffect(value: unknown): SearchFocusEffect {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SEARCH_FOCUS_EFFECT_PRESETS, value)
    ? (value as SearchFocusEffect)
    : DEFAULT_SEARCH_FOCUS_EFFECT
}

/** Apply the selected preset as the themeable CSS contract on the app root. */
export function applySearchFocusEffect(value: unknown): SearchFocusEffect {
  const effect = normalizeSearchFocusEffect(value)
  const preset = SEARCH_FOCUS_EFFECT_PRESETS[effect]
  const root = document.documentElement
  root.style.setProperty('--xmd-focus-effect', effect)
  root.style.setProperty('--xmd-focus-animation', preset.animation)
  root.style.setProperty('--xmd-focus-duration', preset.duration)
  return effect
}
