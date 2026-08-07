import { codeLanguageOptions, resolveCodeLanguageInput } from './codeBlockLanguage'

export interface DetectedCodeLanguage {
  value: string
  label: string
}

const knownLanguages = new Map(codeLanguageOptions.map((option) => [option.value, option]))

function knownLanguage(value: string): DetectedCodeLanguage | null {
  const normalized = resolveCodeLanguageInput(value)
  const option = knownLanguages.get(normalized)
  return option && option.value !== '' ? option : null
}

function looksLikeJson(source: string): boolean {
  if (!/^[\[{]/.test(source)) return false
  try {
    JSON.parse(source)
    return true
  } catch {
    return false
  }
}

function looksLikeMarkup(source: string): string | null {
  if (/^<\?xml\b/i.test(source)) return 'xml'
  if (/^<!doctype\s+html\b/i.test(source)) return 'html'
  if (
    /<(?:html|head|body|script|style|div|span|main|section|article|button|form|template)\b/i.test(
      source,
    ) &&
    /<\/[^>]+>/.test(source)
  )
    return 'html'
  return null
}

function looksLikeCss(source: string): boolean {
  return /(?:^|\n)\s*(?:[.#][\w-]+|[a-z][\w-]*(?:\s*,\s*[.#]?[\w-]+)?)\s*\{[\s\S]*?\b[\w-]+\s*:\s*[^;{}]+;/.test(
    source,
  )
}

function looksLikeYaml(source: string): boolean {
  if (/^---\s*$/.test(source)) return true
  if (/[{};]/.test(source)) return false
  const keyLines = source.split(/\r?\n/).filter((line) => /^\s*[\w.-]+\s*:\s*\S/.test(line))
  return keyLines.length >= 2
}

function detectFromFencedSource(source: string): DetectedCodeLanguage | null {
  const match = source.match(/^(`{3,}|~{3,})\s*([^\s`~]+)[^\n]*\n[\s\S]*\n\1\s*$/)
  return match ? knownLanguage(match[2]) : null
}

/**
 * Conservatively infer a language from a pasted snippet. This intentionally
 * prefers returning null over guessing: a false language changes the Markdown
 * source, while an unknown snippet can safely remain a text code block.
 */
export function detectCodeLanguage(source: string): DetectedCodeLanguage | null {
  const code = source.replace(/^\uFEFF/, '').trim()
  if (!code) return null

  const fenced = detectFromFencedSource(code)
  if (fenced) return fenced
  if (looksLikeJson(code)) return knownLanguage('json')

  const markup = looksLikeMarkup(code)
  if (markup) return knownLanguage(markup)
  if (/^FROM\s+\S+/im.test(code) && /^(?:RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR)\b/im.test(code))
    return knownLanguage('dockerfile')
  if (/^(?:diff --git\s|---\s+[^\n]+\n\+\+\+\s|@@\s)/m.test(code)) return knownLanguage('diff')
  if (
    /^\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|VIEW|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW)|WITH\s+\w+\s+AS)\b/i.test(
      code,
    )
  )
    return knownLanguage('sql')
  if (looksLikeCss(code)) return knownLanguage('css')

  if (
    /(?:^|\n)\s*package\s+main\b/.test(code) ||
    /(?:^|\n)\s*func\s+main\s*\(/.test(code) ||
    /\b(?:fmt\.Println|go\s+func|:=)\b/.test(code)
  )
    return knownLanguage('go')
  if (
    /(?:^|\n)\s*(?:fn\s+main\s*\(|use\s+std::|let\s+mut\s+|impl\s+\w+)/.test(code) ||
    /\b(?:println!|vec!)\s*\(/.test(code)
  )
    return knownLanguage('rust')
  if (
    /(?:^|\n)\s*(?:def\s+\w+\s*\([^\n]*\)\s*:|class\s+\w+\s*(?:\([^)]*\))?\s*:)/.test(code) ||
    /(?:^|\n)\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(code) ||
    (/(?:^|\n)\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+)\b/.test(code) &&
      /(?:^|\n)\s*(?:def|class|print\s*\(|for\s+\w+\s+in\s+)/.test(code))
  )
    return knownLanguage('python')
  if (
    /\bpublic\s+(?:final\s+)?class\s+\w+/.test(code) ||
    /\bpublic\s+static\s+void\s+main\s*\(/.test(code) ||
    /\bSystem\.out\.(?:print|println)\s*\(/.test(code) ||
    /(?:^|\n)\s*import\s+java\./.test(code)
  )
    return knownLanguage('java')
  if (/\b(?:using\s+System|namespace\s+\w+|Console\.WriteLine)\b/.test(code))
    return knownLanguage('c#')
  if (
    /#include\s*<\s*(?:iostream|vector|string|map|memory)\s*>/.test(code) ||
    /\bstd::\w+/.test(code)
  )
    return knownLanguage('c++')
  if (/#include\s*<\s*(?:stdio|stdlib|string)\.h\s*>/.test(code) || /\bint\s+main\s*\(/.test(code))
    return knownLanguage('c')

  if (
    /(?:^|\n)\s*(?:interface\s+\w+|type\s+\w+\s*=|enum\s+\w+)/.test(code) ||
    /\b(?:implements|readonly)\s+\w+/.test(code) ||
    /\b(?:const|let|var)\s+\w+\s*:\s*(?:string|number|boolean|unknown|any|\w+\[\])\b/.test(code)
  )
    return knownLanguage('typescript')
  if (
    /(?:^|\n)\s*(?:const|let|var|function|class)\s+\w+/.test(code) ||
    /=>/.test(code) ||
    /\b(?:console\.|export\s+(?:default|const|function)|import\s+.+\s+from\s+['"])/.test(code)
  )
    return knownLanguage('javascript')

  if (
    /^#!.*\b(?:ba|z)?sh\b/.test(code) ||
    /(?:^|\n)\s*(?:sh|bash|zsh)\s+(?:-[^\s]+\s+)?[^\s]+\.(?:sh|bash|zsh)\b/i.test(code) ||
    (/(?:^|\n)\s*(?:export\s+\w+=|(?:echo|printf|curl|wget|npm|pnpm|yarn|git|docker)\s+\S+)/.test(
      code,
    ) &&
      (code.includes('\n') || /&&|\|\||\$\(/.test(code)))
  )
    return knownLanguage('shell')
  if (/^(?:#{1,6}\s+\S|[-*]\s+\S|\d+\.\s+\S|>\s+\S)/m.test(code) && code.includes('\n'))
    return knownLanguage('markdown')
  if (looksLikeYaml(code)) return knownLanguage('yaml')

  return null
}
