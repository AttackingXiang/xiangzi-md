import { describe, expect, it } from 'vitest'
import { moveTagUnderTarget, renamedTag, renameTagInMarkdown } from './renameTag'
import { documentMetaFromMarkdown } from './frontmatter'

describe('renamedTag', () => {
  it('renames an exact match', () => {
    expect(renamedTag('test', 'test', 'exam')).toBe('exam')
  })
  it('moves a tag under a new parent', () => {
    expect(renamedTag('test', 'test', 'project/test')).toBe('project/test')
  })
  it('carries the whole subtree, preserving suffix casing', () => {
    expect(renamedTag('Test/Wap', 'test', 'project/test')).toBe('project/test/Wap')
  })
  it('does not match a sibling prefix', () => {
    expect(renamedTag('testx', 'test', 'exam')).toBeNull()
    expect(renamedTag('other', 'test', 'exam')).toBeNull()
  })
  it('matches only at a segment boundary', () => {
    expect(renamedTag('claude/test/wap', 'claude/test', 'c/exam')).toBe('c/exam/wap')
    expect(renamedTag('claude/testing', 'claude/test', 'x')).toBeNull()
  })
})

describe('renameTagInMarkdown', () => {
  it('rewrites frontmatter tags and the subtree', () => {
    const md = `---\ntags:\n  - test\n  - test/wap\n  - keep\n---\nbody`
    const { changed, content } = renameTagInMarkdown(md, 'test', 'project/test')
    expect(changed).toBe(true)
    const tags = documentMetaFromMarkdown('/x.md', 'x.md', content, 0).tags
    expect(tags).toContain('project/test')
    expect(tags).toContain('project/test/wap')
    expect(tags).toContain('keep')
    expect(tags).not.toContain('test')
  })

  it('rewrites inline body #tags but skips code', () => {
    const md = `# T\n\nsee #test and #test/wap here\n\n\`\`\`\n#test should stay\n\`\`\`\n\ninline \`#test\` stays too`
    const { content } = renameTagInMarkdown(md, 'test', 'exam')
    expect(content).toContain('#exam and #exam/wap')
    expect(content).toContain('#test should stay') // 代码围栏内不改
    expect(content).toContain('`#test`') // 行内代码不改
  })

  it('leaves untouched docs unchanged', () => {
    const md = `---\ntags:\n  - other\n---\nno tags here`
    const { changed, content } = renameTagInMarkdown(md, 'test', 'exam')
    expect(changed).toBe(false)
    expect(content).toBe(md)
  })

  it('does not touch a sibling-prefixed tag', () => {
    const md = `---\ntags:\n  - testx\n---\nbody`
    expect(renameTagInMarkdown(md, 'test', 'exam').changed).toBe(false)
  })
})

describe('moveTagUnderTarget', () => {
  it('uses the leaf segment under the target', () => {
    expect(moveTagUnderTarget('test', 'project')).toBe('project/test')
    expect(moveTagUnderTarget('a/b', 'c')).toBe('c/b')
    expect(moveTagUnderTarget('claude/test/wap', 'archive')).toBe('archive/wap')
  })
})
