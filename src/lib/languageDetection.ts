/**
 * Lightweight heuristic language detector.
 * Uses a scoring approach: each language accumulates weighted points from
 * distinctive regex patterns; the highest scorer wins.
 * No external dependencies — pure function, safe to call synchronously.
 */
export function autoDetectLanguage(code: string): string | null {
  const t = code.trim()
  if (!t) return null
  const first = t.split('\n')[0].trim()

  // ── Deterministic (shebang & unambiguous markers) ───────────────────────
  if (first.startsWith('#!')) {
    if (/python/.test(first)) return 'Python'
    if (/node|nodejs/.test(first)) return 'JavaScript'
    if (/deno|ts-node/.test(first)) return 'TypeScript'
    if (/ruby/.test(first)) return 'Ruby'
    if (/php/.test(first)) return 'PHP'
    if (/perl/.test(first)) return 'Perl'
    return 'Shell'
  }
  if (first.startsWith('<?xml')) return 'XML'
  if (/^<!DOCTYPE|^<html[\s>]/i.test(first)) return 'HTML'
  if (first.startsWith('<?php')) return 'PHP'
  if (/^FROM\s+\S/.test(first)) return 'Dockerfile'
  if (/^(SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+(TABLE|DATABASE|INDEX)|DROP\s+(TABLE|DATABASE))\b/i.test(first))
    return 'SQL'
  if (/^[{[]/.test(first)) {
    try { JSON.parse(t); return 'JSON' } catch { /* not json */ }
  }
  if (first === '---') return 'YAML'

  // ── Scoring pass ────────────────────────────────────────────────────────
  const h = (rx: RegExp): number => (rx.test(t) ? 1 : 0)

  const scores: [string, number][] = [
    ['TypeScript',
      h(/\binterface\s+\w/) * 10 +
      h(/\benum\s+\w/) * 8 +
      h(/\btype\s+\w+\s*=/) * 8 +
      h(/:\s*(string|number|boolean|void|never|any|unknown)\b/) * 7 +
      h(/\bimport\s+type\b/) * 8 +
      h(/\bas\s+[A-Z]\w*/) * 5 +
      h(/<[A-Z]\w*>/) * 5 +
      h(/\bnull\s*\||\|\s*undefined/) * 6 +
      h(/\b(Readonly|Partial|Record|Pick|Omit|Required)</) * 6],
    ['JavaScript',
      h(/\brequire\s*\(['"]/) * 8 +
      h(/\bmodule\.exports\b/) * 9 +
      h(/\bconsole\.(log|error|warn|info)\b/) * 5 +
      h(/=>\s*[\w({]/) * 4 +
      h(/\bPromise\.(then|catch|all|race)\b/) * 5 +
      h(/\bimport\s+.+\s+from\s+['"]/) * 5 +
      h(/\bexport\s+(default|function|class|const)\b/) * 5 +
      h(/document\.(getElementById|querySelector|addEventListener)/) * 7 +
      h(/\bJSON\.(parse|stringify)\b/) * 5 +
      h(/\bwindow\.\w/) * 5],
    ['Python',
      h(/\bdef\s+\w+\s*\(/) * 8 +
      h(/\bclass\s+\w+.*:/) * 7 +
      h(/\belif\b/) * 9 +
      h(/\bTrue\b|\bFalse\b|\bNone\b/) * 6 +
      h(/\bfrom\s+\w[\w.]*\s+import\b/) * 8 +
      h(/\bself\b/) * 6 +
      h(/\bprint\s*\(/) * 4 +
      h(/^\s*@\w+/m) * 6 +
      h(/\bif\s+__name__\s*==/) * 10 +
      h(/"""/) * 4 +
      h(/\blambda\s+\w/) * 6 +
      h(/\byield\b/) * 5],
    ['Go',
      h(/\bpackage\s+\w+/) * 7 +
      h(/\bfunc\s+\w+\s*\(/) * 7 +
      h(/:=/) * 10 +
      h(/\bimport\s+\(/) * 9 +
      h(/\bfmt\./) * 7 +
      h(/\berr\s*!=\s*nil/) * 10 +
      h(/\bgo\s+func\b/) * 9 +
      h(/\bchan\s+/) * 8 +
      h(/\bdefer\s+/) * 6],
    ['Rust',
      h(/\bfn\s+\w+\s*\(/) * 7 +
      h(/\blet\s+mut\b/) * 10 +
      h(/\bimpl\s+\w/) * 7 +
      h(/\buse\s+std::/) * 10 +
      h(/\bpub\s+fn\b/) * 7 +
      h(/println!\s*\(/) * 9 +
      h(/\bvec!\[/) * 8 +
      h(/\b(Option|Result)</) * 6 +
      h(/#\[derive\(/) * 8 +
      h(/\bunsafe\s*\{/) * 7],
    ['Java',
      h(/\bpublic\s+(static\s+)?class\s+\w/) * 9 +
      h(/\bpublic\s+static\s+void\s+main\b/) * 10 +
      h(/\bSystem\.out\.\w+\b/) * 8 +
      h(/\bimport\s+java\./) * 10 +
      h(/@Override\b/) * 7 +
      h(/@(Autowired|Component|Service|Repository|Controller)\b/) * 8 +
      h(/\bString\[\]\s+args/) * 9 +
      h(/\bthrows\s+\w+Exception\b/) * 7],
    ['Kotlin',
      h(/\bfun\s+\w+\s*\(/) * 9 +
      h(/\bdata\s+class\s+/) * 10 +
      h(/\bcompanion\s+object\b/) * 10 +
      h(/\bwhen\s*\(/) * 7 +
      h(/\bimport\s+kotlin\./) * 9 +
      h(/\?\.\w+/) * 6 +
      h(/\bval\s+\w+\s*[:=]/) * 5 +
      h(/\bobject\s+\w+\s*[\{:]/) * 7],
    ['C#',
      h(/\busing\s+System\b/) * 10 +
      h(/\bnamespace\s+\w/) * 8 +
      h(/\bConsole\.(Write|WriteLine|ReadLine)\b/) * 9 +
      h(/\basync\s+Task\b/) * 9 +
      h(/\bforeach\s*\(/) * 5 +
      h(/\[(Serializable|DataContract|HttpGet|HttpPost)\]/) * 9 +
      h(/\.(Where|Select|ToList|FirstOrDefault)\(/) * 6 +
      h(/\bpartial\s+class\b/) * 8],
    ['C++',
      h(/#include\s*<(iostream|vector|string|map|algorithm|memory|stdexcept)>/) * 10 +
      h(/\bstd::/) * 9 +
      h(/\bcout\s*<</) * 10 +
      h(/\bcin\s*>>/) * 9 +
      h(/\btemplate\s*</) * 10 +
      h(/\bnullptr\b/) * 8 +
      h(/::\w+/) * 4 +
      h(/\bdelete\s+\w/) * 6],
    ['C',
      h(/#include\s*<(stdio|stdlib|string|math|time)\.h>/) * 10 +
      h(/\bprintf\s*\(/) * 9 +
      h(/\bscanf\s*\(/) * 8 +
      h(/\bmalloc\s*\(/) * 10 +
      h(/\bfree\s*\(/) * 7 +
      h(/#define\s+\w/) * 5 +
      h(/\bvoid\s*\*/) * 6 +
      h(/\bNULL\b/) * 5 +
      h(/\bsizeof\s*\(/) * 6],
    ['Shell',
      h(/\bif\s+\[{1,2}/) * 8 +
      h(/\bfi\b/) * 10 +
      h(/\bthen\b/) * 6 +
      h(/\bfor\s+\w+\s+in\b/) * 7 +
      h(/\becho\s+/) * 4 +
      h(/\bexport\s+\w+=/) * 8 +
      h(/\$\{?\w+\}?/) * 3 +
      h(/\|\s*(grep|awk|sed|cut|xargs)\b/) * 8 +
      h(/\bsudo\s+/) * 5 +
      h(/\bdone\b/) * 6],
    ['PHP',
      h(/\$\w+/) * 5 +
      h(/\becho\s+['"]/) * 6 +
      h(/->\w+\s*\(/) * 5 +
      h(/\bforeach\s*\(\$/) * 9 +
      h(/\bpublic\s+function\b/) * 6 +
      h(/\b__(construct|destruct|toString)\b/) * 8 +
      h(/\bnew\s+\w+\s*\(/) * 3 +
      h(/\barray\s*\(/) * 4],
    ['Ruby',
      h(/\bdef\s+\w+/) * 7 +
      h(/\bend\b/) * 5 +
      h(/\bputs\s+/) * 9 +
      h(/\brequire\s+['"]/) * 6 +
      h(/\battr_(reader|writer|accessor)\b/) * 10 +
      h(/\.each\s*(\{|\bdo\b)/) * 7 +
      h(/@\w+/) * 4 +
      h(/\bnil\b/) * 6 +
      h(/\|\w+\|/) * 5],
    ['Swift',
      h(/\bimport\s+(Foundation|UIKit|SwiftUI|AppKit|Combine)\b/) * 10 +
      h(/\bguard\s+let\b/) * 10 +
      h(/\bif\s+let\b/) * 7 +
      h(/@objc\b|@IBOutlet\b|@IBAction\b|@State\b|@Binding\b/) * 10 +
      h(/\bprotocol\s+\w+/) * 7 +
      h(/\bextension\s+\w+/) * 6 +
      h(/\bfunc\s+\w+.*->/) * 6],
    ['CSS',
      h(/\b(color|background(-color)?|font-(size|family|weight)|margin|padding|display|flex|grid|border)\s*:/) * 8 +
      h(/:\s*(px|em|rem|vh|vw|%|auto|none|block|flex|grid|solid|transparent)\b/) * 6 +
      h(/\.[a-z][\w-]*\s*\{/) * 6 +
      h(/#[a-z][\w-]+\s*\{/) * 6 +
      h(/@media\s*\(/) * 9 +
      h(/\b(:hover|:focus|::before|::after)\b/) * 7],
    ['SCSS',
      h(/\$[\w-]+\s*:/) * 10 +
      h(/@(mixin|include|extend|function|each|for|if)\b/) * 9 +
      h(/&\s*(:|\.)/) * 8 +
      h(/\bdarken\s*\(|\blighten\s*\(/) * 8],
    ['YAML',
      h(/^[a-z_][\w-]*:\s*\S/m) * 6 +
      h(/^\s*-\s+\S/m) * 5 +
      h(/^---\s*$/m) * 8 +
      h(/&\w+|<<:\s*\*\w+/) * 9 +
      h(/^\s{2,}\w[\w-]*:\s/m) * 4],
    ['Markdown',
      h(/^#{1,6}\s+\S/m) * 8 +
      h(/^\s*[-*+]\s+\S/m) * 5 +
      h(/^\s*>\s+/m) * 5 +
      h(/\[.+\]\(.+\)/) * 6 +
      h(/^```\w*/m) * 9 +
      h(/!\[.*\]\(.*\)/) * 6],
    ['Scala',
      h(/\bobject\s+\w+/) * 7 +
      h(/\bcase\s+class\s+\w+/) * 10 +
      h(/\bimport\s+scala\./) * 10 +
      h(/\btraits?\s+\w+/) * 8 +
      h(/\bdef\s+\w+\s*[:=(]/) * 5],
    ['R',
      h(/<-\s*/) * 9 +
      h(/\bc\s*\(/) * 5 +
      h(/\blibrary\s*\(/) * 9 +
      h(/\bggplot\s*\(|\bdplyr\b|\btidyverse\b/) * 10 +
      h(/\bdata\.frame\s*\(/) * 9 +
      h(/\bprint\s*\(\w+\)/) * 3],
  ]

  const MIN = 8
  let best: string | null = null
  let bestScore = MIN - 1
  for (const [lang, score] of scores) {
    if (score > bestScore) { bestScore = score; best = lang }
  }

  // C vs C++: any C++ signal overrides a C-only match
  if (best === 'C') {
    const cppScore = scores.find(([l]) => l === 'C++')?.[1] ?? 0
    if (cppScore >= MIN) best = 'C++'
  }

  return best
}
