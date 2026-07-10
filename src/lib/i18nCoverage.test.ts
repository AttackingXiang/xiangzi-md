import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getEnglishDictionaryKeys, hasEnglishTranslation } from './i18n'

/**
 * 构建期守护：src/lib/i18n.ts 用「中文原文当 key」的方式做翻译表，t() 在缺失英文条目时会
 * 静默回退中文——这意味着有人改了组件里的中文文案却忘了同步 EN 词典时，英文界面会悄悄退化
 * 成中文，且不会有任何报错。这个测试文件递归扫描 src/ 下所有 t('...') / t("...") 字面量调用，
 * 断言每个 key 在 EN 词典里都有对应翻译，防止上述静默退化再次发生。
 */

const SRC_ROOT = path.resolve(__dirname, '..')

/** 递归收集 src/ 下所有 .ts/.tsx 源文件，排除测试文件本身。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// 只匹配 t('...') / t("...") 这种「字面量实参」的调用形式；t(someVar) 这类动态调用不在
// 本守护范围内（比如 propertyTypeLabel、KEY_LABELS 的取值，本身就是运行时决定的字符串，
// 无法通过静态正则识别，需要靠人工/其他方式保证覆盖）。
// 字面量里出现反斜杠的情况（比如包含 \n 的多行提示文案）为了保持正则简单直接跳过，不在
// 提取范围内——这些 key 目前数量很少，可以在后续人工审阅时兜底。
const SINGLE_QUOTE_CALL = /\bt\(\s*'([^'\\]*)'\s*\)/g
const DOUBLE_QUOTE_CALL = /\bt\(\s*"([^"\\]*)"\s*\)/g

function extractTranslationKeys(content: string): string[] {
  const keys: string[] = []
  for (const re of [SINGLE_QUOTE_CALL, DOUBLE_QUOTE_CALL]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(content))) {
      keys.push(match[1])
    }
  }
  return keys
}

function collectAllUsedKeys(): Set<string> {
  const files = collectSourceFiles(SRC_ROOT)
  const keys = new Set<string>()
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    for (const key of extractTranslationKeys(content)) {
      keys.add(key)
    }
  }
  return keys
}

describe('i18n EN dictionary coverage', () => {
  it("has an English translation for every t('literal') key used in src/", () => {
    const usedKeys = collectAllUsedKeys()
    const missing = [...usedKeys].filter((key) => !hasEnglishTranslation(key))

    expect(
      missing,
      `Found ${missing.length} key(s) used via t() with no EN translation registered ` +
        `in src/lib/i18n.ts. The English UI will silently fall back to Chinese for these ` +
        `strings. Add them to the EN dictionary:\n${missing.map((k) => `  - ${JSON.stringify(k)}`).join('\n')}`,
    ).toEqual([])
  })

  it('warns about EN dictionary entries with no matching t() literal call (informational only)', () => {
    const usedKeys = collectAllUsedKeys()
    const dictKeys = getEnglishDictionaryKeys()
    const unreferenced = dictKeys.filter((key) => !usedKeys.has(key))

    // 这里不做硬断言：EN 词典里的一些条目会被 t(变量) 动态引用（例如属性类型标签、
    // 快捷键分组名、通过候选键数组拼出来的 t(candidate) 调用等），这些 key 在静态正则
    // 扫描下天然「看起来没被用到」，但实际上是被使用的。把它当作断言失败会不断误伤，
    // 所以只打印警告，留给人工在改动时自行判断是否是真正的死条目。
    if (unreferenced.length > 0) {
      console.warn(
        `[i18nCoverage] ${unreferenced.length} EN dictionary entr${unreferenced.length === 1 ? 'y has' : 'ies have'} ` +
          `no direct t('literal') reference found in src/ (may still be used via t(variable)):\n` +
          unreferenced.map((k) => `  - ${JSON.stringify(k)}`).join('\n'),
      )
    }

    // 只是记录数量存在即可，真正的判定留给上面的 console.warn 输出人工审阅。
    expect(unreferenced.length).toBeGreaterThanOrEqual(0)
  })
})
