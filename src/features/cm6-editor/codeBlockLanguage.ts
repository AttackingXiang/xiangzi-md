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

const knownByName = new Map<string, CodeLanguageOption>()
for (const description of languages) {
  const option = { label: description.name, value: description.name.toLowerCase() }
  // A fence info string stops at the first space, so a multi-word value would not
  // round-trip through the Markdown source.
  if (/\s/.test(option.value)) continue
  for (const name of [description.name, ...description.alias]) {
    const key = name.toLowerCase()
    if (!knownByName.has(key)) knownByName.set(key, option)
  }
}

/**
 * Resolve a language name or alias to a fence value, accepting only exact matches.
 * Unlike {@link resolveCodeLanguageInput} this never falls back to fuzzy or prefix
 * matching, which turns unrelated names into confident nonsense ("plaintext" matches
 * LaTeX, "javascriptreact" matches Java). Detection needs the strict variant.
 */
export function matchKnownCodeLanguage(name: string): CodeLanguageOption | null {
  return knownByName.get(name.trim().toLowerCase()) ?? null
}

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
