import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

export interface CodeLanguageOption {
  label: string
  value: string
}

export const codeLanguageOptions: readonly CodeLanguageOption[] = [
  { label: 'Text', value: '' },
  ...languages
    .map((description) => ({ label: description.name, value: description.name.toLowerCase() }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

export function normalizedLanguageValue(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return ''
  return (
    LanguageDescription.matchLanguageName(languages, normalized, true)?.name.toLowerCase() ??
    normalized
  )
}

export function resolveCodeLanguageInput(language: string): string {
  const typed = language.trim().toLowerCase()
  if (!typed || typed === 'text') return ''
  const matched = LanguageDescription.matchLanguageName(languages, typed, true)
  if (matched) return matched.name.toLowerCase()
  const prefix = codeLanguageOptions.find(
    (entry) => entry.value.startsWith(typed) || entry.label.toLowerCase().startsWith(typed),
  )
  return prefix?.value ?? typed
}

export function matchingCodeLanguageOptions(
  language: string,
  limit = 8,
): readonly CodeLanguageOption[] {
  const typed = language.trim().toLowerCase()
  const matches = typed
    ? codeLanguageOptions.filter(
        (entry) =>
          (entry.value || 'text').startsWith(typed) || entry.label.toLowerCase().startsWith(typed),
      )
    : [...codeLanguageOptions]
  const canonical = typed
    ? LanguageDescription.matchLanguageName(languages, typed, true)?.name.toLowerCase()
    : null
  const canonicalOption = canonical
    ? codeLanguageOptions.find((entry) => entry.value === canonical)
    : undefined
  const ranked = canonicalOption
    ? [canonicalOption, ...matches.filter((entry) => entry !== canonicalOption)]
    : matches
  return ranked.slice(0, Math.max(0, limit))
}
