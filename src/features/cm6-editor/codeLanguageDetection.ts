import { matchKnownCodeLanguage } from './codeBlockLanguage'

export interface DetectedCodeLanguage {
  value: string
  label: string
}

function knownLanguage(value: string): DetectedCodeLanguage | null {
  return matchKnownCodeLanguage(value)
}

/**
 * One piece of evidence for a language. `repeat` signals scale with how often they
 * occur (capped), so three shell command lines outweigh one incidental match.
 */
interface LanguageSignal {
  pattern: RegExp
  weight: number
  repeat?: boolean
}

/**
 * `parent` marks a language as a superset of another: TypeScript scores every
 * JavaScript signal too, so the two never split the evidence for one snippet. The
 * family scores together and only promotes the child when the child-exclusive
 * evidence is strong enough on its own.
 */
interface LanguageProfile {
  language: string
  parent?: string
  signals: readonly LanguageSignal[]
}

const REPEAT_CAP = 3
/** Below this the winner is a coin flip; a wrong fence is worse than a plain one. */
const MIN_SCORE = 5
/** The winner also has to be clearly ahead of the runner-up from another family. */
const MIN_MARGIN = 2
/** How much child-exclusive evidence promotes e.g. JavaScript to TypeScript. */
const MIN_CHILD_SCORE = 3

const javascriptSignals: readonly LanguageSignal[] = [
  { pattern: /\b(?:const|let)\s+[\w{[]/g, weight: 2, repeat: true },
  // An untyped `const` binding. Not `let`, which Swift uses the same way; Rust and
  // C++ both require a type between `const` and the `=`.
  { pattern: /\bconst\s+\w+\s*=/, weight: 3 },
  { pattern: /=>/g, weight: 2, repeat: true },
  { pattern: /\bfunction\s*\w*\s*\(/, weight: 2 },
  // No other C-family language declares a function with a bare `function` keyword
  // and no return type; PHP is the exception and is settled by its `<?php` anchor.
  { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^\n)]*\)\s*\{/m, weight: 4 },
  { pattern: /\bconsole\.(?:log|error|warn|info|debug)\s*\(/, weight: 4 },
  { pattern: /\b(?:require\s*\(|module\.exports\b|exports\.\w+)/, weight: 5 },
  { pattern: /\bimport\s+[\w*{},\s]+from\s+['"]/, weight: 4 },
  { pattern: /\bexport\s+(?:default|const|function|class|\{)/, weight: 4 },
  { pattern: /\b(?:document|window|globalThis)\.\w+/, weight: 4 },
  { pattern: /\basync\s+(?:function\b|\(|\w+\s*\()/, weight: 2 },
  { pattern: /\bawait\s+\w/, weight: 2 },
  { pattern: /\.(?:then|catch|finally)\s*\(/, weight: 2 },
  { pattern: /\bnew\s+(?:Promise|Map|Set|Error|Date)\b/, weight: 3 },
  { pattern: /===|!==/, weight: 3 },
  { pattern: /\.(?:map|filter|forEach|reduce)\s*\(\s*(?:\(|\w+\s*=>)/, weight: 3 },
  { pattern: /`[^`]*\$\{[^}]*\}/, weight: 3 },
  { pattern: /\bconstructor\s*\(/, weight: 4 },
  { pattern: /\bthis\.\w+\s*=/, weight: 1 },
  { pattern: /\bnull\b|\bundefined\b/, weight: 1 },
]

const typescriptSignals: readonly LanguageSignal[] = [
  { pattern: /\binterface\s+\w+[^\n{]*\{/, weight: 5 },
  { pattern: /\btype\s+\w+(?:<[^\n>]*>)?\s*=/, weight: 5 },
  { pattern: /\benum\s+\w+\s*\{/, weight: 5 },
  { pattern: /\b(?:import|export)\s+type\b/, weight: 5 },
  { pattern: /\b(?:keyof|satisfies|namespace|declare)\b/, weight: 4 },
  { pattern: /\bas\s+(?:const|unknown)\b/, weight: 4 },
  {
    pattern: /:\s*(?:string|number|boolean|void|any|unknown|never|object)\b/g,
    weight: 3,
    repeat: true,
  },
  { pattern: /\b(?:public|private|protected|readonly)\s+\w+\s*[?:(]/, weight: 4 },
  { pattern: /\bimplements\s+\w/, weight: 3 },
  { pattern: /\)\s*:\s*(?:Promise<|\w+(?:\[\]|<[^\n>]+>)?)\s*[{=]/, weight: 3 },
  { pattern: /<\w+(?:\s+extends\s+[\w.[\]]+)?(?:,\s*\w+)*>\s*\(/, weight: 3 },
  // Same line only: `\s` would let this match a Python `def f():` header.
  { pattern: /\)[ \t]*:[ \t]*[\w[{(]/, weight: 2 },
  { pattern: /\w\??\s*:\s*\w+(?:\[\]|<[^\n>]+>)\s*[,;)\n]/, weight: 2 },
  { pattern: /[\w}]\s*:\s*[A-Z]\w*(?:\[\]|<[^\n>]*>)?\s*[,;)=>]/, weight: 3 },
]

const cSignals: readonly LanguageSignal[] = [
  { pattern: /^#\s*include\s*[<"]/m, weight: 4 },
  { pattern: /^#\s*(?:define|ifndef|pragma)\b/m, weight: 3 },
  { pattern: /\b(?:printf|sprintf|malloc|free|memcpy|sizeof)\s*\(/, weight: 4 },
  { pattern: /\b(?:int|char|void|float|double|unsigned|size_t)\s+\*?\w+\s*[;=,)]/g, weight: 2, repeat: true }, // prettier-ignore
  { pattern: /\bstruct\s+\w+\s*\{/, weight: 2 },
  { pattern: /\btypedef\b/, weight: 3 },
  { pattern: /\bint\s+main\s*\(/, weight: 3 },
  { pattern: /\*\w+\s*=|=\s*\*\w+|&\w+\b/, weight: 2 },
  { pattern: /\bNULL\b/, weight: 2 },
  { pattern: /\bfor\s*\(\s*(?:int|long|size_t|unsigned)\s+\w+\s*=/, weight: 4 },
]

const cppSignals: readonly LanguageSignal[] = [
  { pattern: /\bstd::\w+/g, weight: 4, repeat: true },
  { pattern: /^#\s*include\s*<(?:iostream|vector|string|map|memory|algorithm)>/m, weight: 5 },
  { pattern: /\b(?:public|private|protected)\s*:/g, weight: 4, repeat: true },
  { pattern: /\btemplate\s*</, weight: 5 },
  { pattern: /\b(?:nullptr|constexpr|namespace)\b/, weight: 4 },
  { pattern: /\b(?:cout|cin|cerr)\s*(?:<<|>>)/, weight: 5 },
  { pattern: /\bclass\s+\w+[^\n]*\{/, weight: 2 },
  { pattern: /\bnew\s+\w+\s*[({]/, weight: 1 },
]

const cssSignals: readonly LanguageSignal[] = [
  { pattern: /^\s*[.#]?[\w-]+(?:[.#:][\w-()]+)*(?:\s*[>+~,]\s*[\w.#:-]+)*\s*\{/gm, weight: 3, repeat: true }, // prettier-ignore
  { pattern: /^\s*[a-z-]+\s*:\s*[^;{}\n]+;/gm, weight: 2, repeat: true },
  { pattern: /\b(?:color|background|margin|padding|display|font-size|border|width|height|flex|grid)\s*:/, weight: 3 }, // prettier-ignore
  { pattern: /@(?:media|import|font-face|keyframes|supports)\b/, weight: 4 },
  { pattern: /:\s*(?:#[0-9a-f]{3,8}|\d+(?:px|rem|em|vh|vw|%)|var\(--)/i, weight: 3 },
  { pattern: /::?(?:hover|focus|active|before|after|root|not|nth-child)\b/, weight: 4 },
  { pattern: /!important/, weight: 3 },
]

const scssSignals: readonly LanguageSignal[] = [
  { pattern: /^\s*\$[\w-]+\s*:/m, weight: 5 },
  { pattern: /&[.:#\s]/, weight: 5 },
  { pattern: /@(?:mixin|include|extend|use|forward|each|if)\b/, weight: 5 },
  { pattern: /#\{\$?[\w-]+\}/, weight: 4 },
]

/** Shared by the HTML profile and, negated, by the XML one. */
const htmlElementPattern =
  /<(?:div|span|p|a|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|img|br|hr|input|button|form|label|select|option|textarea|section|nav|header|footer|main|article|aside|script|style|link|meta|body|head|html|title|strong|em|b|i|code|pre|blockquote|iframe|svg|figure|video|audio)\b/i

const languageProfiles: readonly LanguageProfile[] = [
  { language: 'javascript', signals: javascriptSignals },
  { language: 'typescript', parent: 'javascript', signals: typescriptSignals },
  { language: 'c', signals: cSignals },
  { language: 'c++', parent: 'c', signals: cppSignals },
  { language: 'css', signals: cssSignals },
  { language: 'scss', parent: 'css', signals: scssSignals },
  {
    language: 'python',
    signals: [
      { pattern: /^\s*def\s+\w+\s*\([^\n]*\)\s*(?:->[^\n:]+)?:/m, weight: 5 },
      { pattern: /^\s*class\s+\w+\s*(?:\([^\n)]*\))?\s*:/m, weight: 5 },
      {
        pattern: /^\s*(?:from\s+[\w.]+\s+import\b|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$)/m,
        weight: 4,
      },
      { pattern: /^\s*if\s+__name__\s*==/m, weight: 5 },
      { pattern: /\bself\.\w+/g, weight: 3, repeat: true },
      { pattern: /\bprint\s*\(/, weight: 2 },
      { pattern: /\bf["'][^"'\n]*\{/, weight: 4 },
      { pattern: /^\s*(?:elif|except|finally)\b|^\s*try\s*:/m, weight: 4 },
      { pattern: /\b(?:None|True|False)\b/g, weight: 3, repeat: true },
      { pattern: /^\s*for\s+\w+\s+in\s+[^\n:]+:/m, weight: 4 },
      { pattern: /^\s*(?:while|with)\s+[^\n:]+:/m, weight: 3 },
      { pattern: /^\s*@\w+(?:\.\w+)*(?:\([^\n]*\))?\s*$/m, weight: 3 },
      { pattern: /\brange\s*\(|\blen\s*\(|\.append\s*\(/, weight: 3 },
      { pattern: /\bjson\.(?:load|loads|dump|dumps)\s*\(|\bopen\s*\([^\n)]*\)\s*as\b/, weight: 4 },
      { pattern: /^\s*(?:pass|raise|yield)\b/m, weight: 3 },
      { pattern: /\[[^\n\]]*\bfor\s+\w+\s+in\s+[^\n\]]*\]/, weight: 5 },
      { pattern: /;\s*$/m, weight: -3 },
      { pattern: /^\s*\}\s*$/m, weight: -3 },
    ],
  },
  {
    language: 'java',
    signals: [
      { pattern: /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\s+\w+/, weight: 5 }, // prettier-ignore
      { pattern: /\bpublic\s+static\s+void\s+main\s*\(/, weight: 6 },
      { pattern: /\bSystem\.(?:out|err)\.print/, weight: 6 },
      { pattern: /^\s*import\s+(?:java|javax)\./m, weight: 6 },
      { pattern: /^\s*package\s+[\w.]+;/m, weight: 4 },
      { pattern: /\bnew\s+\w+<[^\n>]*>\s*\(/, weight: 4 },
      { pattern: /\b(?:String|List|Map|Set|Integer|ArrayList|HashMap)<?[\w,\s<>]*>?\s+\w+\s*[=;]/, weight: 3 }, // prettier-ignore
      { pattern: /@(?:Override|Autowired|Service|Component|Test|Entity|SpringBootApplication)\b/, weight: 6 }, // prettier-ignore
      { pattern: /\bString\[\]\s+\w+/, weight: 4 },
      { pattern: /\b(?:extends|implements)\s+\w+/, weight: 2 },
      { pattern: /\bthrows\s+\w*Exception\b/, weight: 4 },
      { pattern: /\.equals\s*\(|\.length\(\)/, weight: 2 },
      { pattern: /\.stream\s*\(\s*\)/, weight: 5 },
      { pattern: /\b\w+::\w+/, weight: 4 },
      { pattern: /\bCollectors\.\w+|\bOptional\.\w+/, weight: 5 },
    ],
  },
  {
    language: 'c#',
    signals: [
      { pattern: /\{\s*get;\s*(?:set;\s*)?\}/, weight: 6 },
      { pattern: /^\s*using\s+(?:System|Microsoft)(?:\.[\w.]+)?\s*;/m, weight: 6 },
      { pattern: /\bConsole\.(?:WriteLine|Write|ReadLine)\s*\(/, weight: 6 },
      { pattern: /^\s*namespace\s+[\w.]+/m, weight: 4 },
      { pattern: /\b(?:public|private|internal)\s+(?:static\s+)?(?:async\s+)?(?:class|record|struct|interface)\s+\w+/, weight: 3 }, // prettier-ignore
      { pattern: /\basync\s+Task(?:<[^\n>]*>)?\s+\w+\s*\(/, weight: 6 },
      { pattern: /\bvar\s+\w+\s*=\s*new\s+\w/, weight: 3 },
      { pattern: /\b(?:string|int|bool|decimal)\s+\w+\s*(?:=|\{|;)/, weight: 2 },
      { pattern: /\[(?:HttpGet|HttpPost|Serializable|Required|ApiController)\b/, weight: 6 },
      { pattern: /\bnameof\s*\(|\?\?=|\bIEnumerable</, weight: 5 },
      { pattern: /\bvar\s+\w+\s*=/, weight: 2 },
      { pattern: /\.(?:Where|Select|ToList|ToArray|FirstOrDefault|OrderBy|Any|Count)\s*\(/, weight: 4 }, // prettier-ignore
      { pattern: /\.\w+\(\s*\w+\s*=>/, weight: 3 },
    ],
  },
  {
    language: 'go',
    signals: [
      { pattern: /^\s*package\s+\w+\s*$/m, weight: 4 },
      { pattern: /^\s*func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s*)?\w+\s*\(/m, weight: 5 },
      { pattern: /\bif\s+err\s*!=\s*nil\b/, weight: 6 },
      { pattern: /:=/g, weight: 3, repeat: true },
      { pattern: /^\s*type\s+\w+\s+(?:struct|interface)\s*\{/m, weight: 6 },
      { pattern: /\b(?:fmt|errors|context|http)\.\w+\(/, weight: 4 },
      { pattern: /^\s*import\s+\(/m, weight: 4 },
      { pattern: /\breturn\s+\w*,\s*(?:err|nil)\b/, weight: 5 },
      { pattern: /\b(?:chan\s+\w|go\s+func\b|defer\s+\w|interface\{\})/, weight: 5 },
      { pattern: /^\t\w+\s+(?:string|int|int64|bool|float64|error)\s*$/m, weight: 4 },
      { pattern: /\bnil\b/, weight: 2 },
    ],
  },
  {
    language: 'rust',
    signals: [
      { pattern: /^\s*(?:pub\s+)?fn\s+\w+/m, weight: 5 },
      { pattern: /^\s*#\[[\w:(]/m, weight: 5 },
      { pattern: /\blet\s+mut\s+\w/, weight: 6 },
      { pattern: /^\s*use\s+(?:std|crate|super|serde)(?:::|;)/m, weight: 6 },
      { pattern: /\bimpl(?:<[^\n>]*>)?\s+\w/, weight: 6 },
      { pattern: /\b\w+!\s*[([]/, weight: 5 },
      { pattern: /\b(?:i8|i32|i64|u8|u32|u64|usize|f64)\b/g, weight: 3, repeat: true },
      { pattern: /&(?:mut\s+)?(?:str|self)\b|\bString::/, weight: 5 },
      { pattern: /\b(?:Option|Result|Vec|Box|Arc|HashMap)<[^\n>]*>/, weight: 4 },
      { pattern: /\bmatch\s+\w+[^\n]*\{/, weight: 3 },
      { pattern: /->\s*\w/, weight: 2 },
      { pattern: /\.(?:unwrap|expect|iter|collect)\s*\(/, weight: 4 },
      { pattern: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+\w/m, weight: 3 },
    ],
  },
  {
    language: 'php',
    signals: [
      { pattern: /\$\w+\s*(?:=|->|\))/g, weight: 3, repeat: true },
      { pattern: /\becho\s+["'$]/, weight: 4 },
      { pattern: /\bfunction\s+\w+\s*\(\s*\$/, weight: 5 },
      { pattern: /->\w+\s*\(/, weight: 2 },
      { pattern: /^\s*(?:namespace|use)\s+[\w\\]+\\/m, weight: 5 },
      { pattern: /\barray\s*\(|\[\s*['"][^'"\n]*['"]\s*=>/, weight: 4 },
      { pattern: /\bpublic\s+function\s+\w+/, weight: 5 },
      { pattern: /\$this->/, weight: 6 },
    ],
  },
  {
    language: 'ruby',
    signals: [
      { pattern: /^\s*end\s*$/gm, weight: 4, repeat: true },
      { pattern: /^\s*def\s+\w+[?!]?(?:\s*\([^\n)]*\))?\s*$/m, weight: 5 },
      { pattern: /\bdo\s*\|\w/, weight: 6 },
      { pattern: /^\s*(?:puts|require|require_relative)\s+['"\w]/m, weight: 5 },
      { pattern: /\bclass\s+\w+\s*<\s*\w/, weight: 5 },
      { pattern: /@\w+\s*=|@@\w+/, weight: 4 },
      { pattern: /\b\w+\s+:\w+(?:,\s*\w+:)?/, weight: 3 },
      { pattern: /\b(?:attr_accessor|attr_reader|validates|belongs_to|has_many)\b/, weight: 6 },
      { pattern: /\.nil\?|\bunless\b|\belsif\b|=>\s*\w/, weight: 3 },
      { pattern: /\bmodule\s+\w+\s*$/m, weight: 3 },
    ],
  },
  {
    language: 'swift',
    signals: [
      { pattern: /^\s*(?:public\s+|private\s+)?func\s+\w+\s*\(/m, weight: 5 },
      { pattern: /\b(?:var|let)\s+\w+\s*:\s*\w/, weight: 4 },
      { pattern: /\bsome\s+\w/, weight: 6 },
      { pattern: /\b(?:guard|if)\s+let\s+\w/, weight: 6 },
      { pattern: /@(?:State|Binding|Published|IBOutlet|objc|MainActor|Environment)\b/, weight: 6 },
      { pattern: /^\s*(?:struct|class|extension)\s+\w+\s*:\s*\w/m, weight: 4 },
      { pattern: /^\s*import\s+(?:Foundation|SwiftUI|UIKit|Combine)\b/m, weight: 6 },
      { pattern: /\bself\.\w+\s*=|\?\?|\w+\?\./, weight: 2 },
      { pattern: /\boverride\s+func\b|\bmutating\s+func\b/, weight: 6 },
      { pattern: /\b(?:async\s+)?throws\s*(?:->|\{)/, weight: 6 },
      { pattern: /\btry\s+(?:await\s+)?\w/, weight: 5 },
      { pattern: /\{\s*\$\d\b/, weight: 6 },
    ],
  },
  {
    language: 'kotlin',
    signals: [
      { pattern: /^\s*(?:suspend\s+|override\s+|private\s+)?fun\s+\w+\s*\(/m, weight: 5 },
      { pattern: /\bval\s+\w+\s*(?::\s*\w+)?\s*=/g, weight: 3, repeat: true },
      { pattern: /\b(?:data|sealed)\s+class\s+\w/, weight: 6 },
      { pattern: /\bcompanion\s+object\b/, weight: 6 },
      { pattern: /\b(?:listOf|mutableListOf|mapOf|setOf)\s*\(/, weight: 5 },
      { pattern: /\bprintln\s*\(/, weight: 4 },
      { pattern: /\?:\s*\w|\?\.\w+|!!\B/, weight: 3 },
      { pattern: /^\s*import\s+(?:kotlin|kotlinx|androidx)\./m, weight: 6 },
      { pattern: /\bvar\s+\w+\s*:\s*\w+\??\s*=/, weight: 3 },
      { pattern: /\b(?:suspend\s+fun|withContext\s*\(|Dispatchers\.|coroutineScope\b)/, weight: 6 },
    ],
  },
  {
    language: 'shell',
    signals: [
      { pattern: /^\s*(?:sudo\s+)?(?:sh|bash|zsh|ls|cd|cat|echo|grep|awk|sed|curl|wget|tail|head|ps|kill|chmod|chown|mkdir|rm|cp|mv|touch|find|tar|ssh|scp|df|du|export|source|which|git|npm|pnpm|yarn|node|docker|kubectl|brew|apt|yum|systemctl|make|python3?|pip3?)(?:[ \t]+[^\s=]|[ \t]*$)/gm, weight: 3, repeat: true }, // prettier-ignore
      { pattern: /\$\((?!\{)|\$\{\w+[:}]|\$\w+\b/g, weight: 2, repeat: true },
      { pattern: /\s\|\s*(?:grep|awk|sed|sort|uniq|head|tail|wc|xargs|jq)\b/, weight: 5 },
      { pattern: /\s-{1,2}[a-z][\w-]*\b/gi, weight: 1, repeat: true },
      { pattern: /\b(?:&&|\|\|)\s/, weight: 2 },
      { pattern: /^\s*(?:fi|esac|done|else)\s*$/m, weight: 4 },
      { pattern: /\b(?:set\s+-[euxo]|2>&1|\/dev\/null)/, weight: 5 },
      { pattern: /^\s*(?:if|for|while)\b[^\n]*;\s*(?:then|do)\s*$/m, weight: 6 },
      { pattern: /^\s*export\s+\w+=/m, weight: 5 },
      { pattern: /^[^\n]*\.(?:sh|bash|zsh)\b/m, weight: 4 },
    ],
  },
  {
    language: 'sql',
    signals: [
      { pattern: /\bselect\b[\s\S]{0,200}?\bfrom\b/i, weight: 6 },
      { pattern: /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i, weight: 6 },
      { pattern: /\b(?:create|alter|drop)\s+(?:table|view|index|database|schema)\b/i, weight: 6 },
      { pattern: /\b(?:inner\s+|left\s+|right\s+|outer\s+)?join\b[^\n]*\bon\b/i, weight: 5 },
      { pattern: /\b(?:where|group\s+by|order\s+by|having|limit|union\s+all?)\b/gi, weight: 2, repeat: true }, // prettier-ignore
      { pattern: /\b(?:count|sum|avg|min|max)\s*\(/i, weight: 3 },
      { pattern: /\bwith\s+\w+\s+as\s*\(/i, weight: 5 },
      { pattern: /\b(?:varchar|primary\s+key|foreign\s+key|not\s+null|auto_increment)\b/i, weight: 5 }, // prettier-ignore
    ],
  },
  {
    language: 'yaml',
    signals: [
      { pattern: /^\s*[\w.-]+:(?:\s+\S|\s*$)/gm, weight: 2, repeat: true },
      // A key that actually carries a value. Prose headings ("Todo:", "Note: ...")
      // hit the pattern above but a bare-word key with a scalar after it is config.
      { pattern: /^[\w.-]+:[ \t]+\S/m, weight: 2 },
      { pattern: /^---\s*$/m, weight: 5 },
      // Weak on its own: a dash list is just as likely to be a Markdown bullet.
      { pattern: /^\s*-\s+[\w"'{[]/gm, weight: 1, repeat: true },
      { pattern: /^\s{2,}[\w.-]+:/m, weight: 3 },
      { pattern: /:\s*(?:\||>)-?\s*$/m, weight: 5 },
      { pattern: /^\s*#[^\n]*$/m, weight: 1 },
      { pattern: /[;{]\s*$/m, weight: -4 },
      { pattern: /^\s*(?:function|class|def|const|let|var|public|import\s+\w+;)\b/m, weight: -4 },
    ],
  },
  {
    language: 'toml',
    signals: [
      { pattern: /^\s*\[{1,2}[\w.-]+\]{1,2}\s*$/gm, weight: 5, repeat: true },
      { pattern: /^\s*[\w.-]+\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|\d|true|false|[[{])/gm, weight: 2, repeat: true }, // prettier-ignore
      { pattern: /^\s*#[^\n]*$/m, weight: 1 },
      // Inline tables end a line with a brace, so only an opening brace that is not
      // a value — that is, a block header — rules TOML out. So does a semicolon.
      { pattern: /;\s*$/m, weight: -4 },
      { pattern: /^(?![^\n=]*=)[^\n]*\{\s*$/m, weight: -4 },
    ],
  },
  {
    language: 'html',
    signals: [
      { pattern: new RegExp(htmlElementPattern.source, 'gi'), weight: 3, repeat: true },
      { pattern: /\s(?:class|id|href|src|style|alt|type|value|placeholder)\s*=\s*["']/, weight: 3 },
      { pattern: /&(?:nbsp|amp|lt|gt|quot);/, weight: 3 },
    ],
  },
  {
    language: 'xml',
    signals: [
      { pattern: /xmlns(?::\w+)?\s*=/, weight: 6 },
      { pattern: /<[\w-]+:[\w-]+[\s>/]/, weight: 5 },
      { pattern: /<!\[CDATA\[|<!ENTITY|<!ELEMENT/, weight: 6 },
      { pattern: /<\/[\w.:-]+>/g, weight: 2, repeat: true },
      { pattern: /<[\w.-]+(?:\s+[\w.:-]+="[^"\n]*")+\s*\/?>/g, weight: 2, repeat: true },
      { pattern: /^\s*<[\w.-]+>\s*$/m, weight: 2 },
      // Tag soup made of known HTML elements is HTML, not generic XML.
      { pattern: htmlElementPattern, weight: -5 },
    ],
  },
  {
    language: 'dockerfile',
    signals: [
      { pattern: /^\s*FROM\s+[\w./:-]+/m, weight: 6 },
      { pattern: /^\s*(?:RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|ENV|EXPOSE|VOLUME|ARG|LABEL|USER|HEALTHCHECK)\s+\S/gm, weight: 4, repeat: true }, // prettier-ignore
      { pattern: /^\s*FROM\s+\S+\s+AS\s+\w+/im, weight: 4 },
    ],
  },
  {
    language: 'markdown',
    signals: [
      { pattern: /^#{1,6}\s+\S/gm, weight: 4, repeat: true },
      { pattern: /\[[^\]\n]+\]\([^)\n]+\)/, weight: 5 },
      { pattern: /^\s*(?:[-*+]|\d+\.)\s+\S/gm, weight: 1, repeat: true },
      { pattern: /^\s*>\s+\S/m, weight: 3 },
      { pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/, weight: 3 },
      { pattern: /^\s*(?:```|~~~)/m, weight: 4 },
      { pattern: /^\s*\|[^\n]*\|\s*$/m, weight: 3 },
      { pattern: /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/m, weight: 5 },
      { pattern: /^\s*(?:[-*_]\s*){3,}$/m, weight: 3 },
      { pattern: /!\[[^\]\n]*\]\(/, weight: 5 },
    ],
  },
]

function scoreProfile(code: string, profile: LanguageProfile): number {
  let score = 0
  for (const signal of profile.signals) {
    if (signal.repeat) {
      const count = code.match(signal.pattern)?.length ?? 0
      score += signal.weight * Math.min(count, REPEAT_CAP)
    } else if (signal.pattern.test(code)) {
      score += signal.weight
    }
  }
  return score
}

interface Candidate {
  language: string
  score: number
}

/** Score every language family, best first. */
function rankCodeLanguages(code: string): readonly Candidate[] {
  const scores = new Map<string, number>()
  for (const profile of languageProfiles) {
    scores.set(profile.language, Math.max(0, scoreProfile(code, profile)))
  }

  const candidates: Candidate[] = []
  for (const profile of languageProfiles) {
    if (profile.parent) continue
    const parentScore = scores.get(profile.language) ?? 0
    const children = languageProfiles.filter((entry) => entry.parent === profile.language)
    const best = children.reduce<{ language: string; score: number } | null>((winner, child) => {
      const score = scores.get(child.language) ?? 0
      return !winner || score > winner.score ? { language: child.language, score } : winner
    }, null)
    const childScore = best?.score ?? 0
    candidates.push({
      language: best && childScore >= MIN_CHILD_SCORE ? best.language : profile.language,
      score: parentScore + childScore,
    })
  }
  return candidates.sort((a, b) => b.score - a.score)
}

function looksLikeJson(source: string): boolean {
  if (!/^[[{]/.test(source)) return false
  const tolerant = source.replace(/,(\s*[}\]])/g, '$1')
  try {
    JSON.parse(tolerant)
    return true
  } catch {
    return false
  }
}

function detectFromFencedSource(source: string): DetectedCodeLanguage | null {
  const match = source.match(/^(`{3,}|~{3,})\s*([^\s`~]+)[^\n]*\n[\s\S]*\n\1\s*$/)
  return match ? knownLanguage(match[2]) : null
}

const shebangLanguages: readonly (readonly [RegExp, string])[] = [
  [/\bpython[\d.]*\b/, 'python'],
  [/\bnode\b|\bdeno\b|\bbun\b/, 'javascript'],
  [/\bruby\b/, 'ruby'],
  [/\bperl\b/, 'perl'],
  [/\bphp\b/, 'php'],
  [/\blua\b/, 'lua'],
  [/\b(?:ba|z|k|a|da)?sh\b|\bfish\b/, 'shell'],
]

/** Unambiguous markers that settle the language without any scoring. */
function detectFromAnchor(code: string): DetectedCodeLanguage | null {
  const shebang = code.match(/^#!([^\n]*)/)
  if (shebang) {
    for (const [pattern, language] of shebangLanguages) {
      if (pattern.test(shebang[1])) return knownLanguage(language)
    }
    return knownLanguage('shell')
  }
  if (/^<\?php\b/i.test(code)) return knownLanguage('php')
  if (/^<\?xml\b/i.test(code)) return knownLanguage('xml')
  if (/^<!doctype\s+html\b/i.test(code)) return knownLanguage('html')
  if (/^(?:diff --git\s|(?:---|\*\*\*)\s+[^\n]+\n(?:\+\+\+|---)\s|@@\s)/m.test(code))
    return knownLanguage('diff')
  if (looksLikeJson(code)) return knownLanguage('json')
  return null
}

/**
 * Conservatively infer a language from a pasted snippet. Every language is scored
 * against weighted evidence and the winner has to clear both an absolute floor and a
 * margin over the runner-up; otherwise this returns null. That bias is deliberate: a
 * wrong language rewrites the Markdown source, while an unrecognized snippet stays a
 * plain text block the author can label in one click.
 */
export function detectCodeLanguage(source: string): DetectedCodeLanguage | null {
  const code = source.replace(/^\uFEFF/, '').trim()
  if (!code) return null

  const fenced = detectFromFencedSource(code)
  if (fenced) return fenced
  const anchored = detectFromAnchor(code)
  if (anchored) return anchored

  const [winner, runnerUp] = rankCodeLanguages(code)
  if (!winner || winner.score < MIN_SCORE) return null
  if (runnerUp && winner.score - runnerUp.score < MIN_MARGIN) return null
  return knownLanguage(winner.language)
}
