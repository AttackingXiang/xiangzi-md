import { describe, expect, it } from 'vitest'
import {
  moveTagUnderTarget,
  promoteTagOneLevel,
  renamedTag,
  renameTagInFiles,
  renameTagInMarkdown,
} from './renameTag'
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

describe('renameTagInFiles (bulk loop)', () => {
  it('rewrites every affected doc, not just one', async () => {
    const files: Record<string, string> = {
      'a.md': `---\ntags:\n  - Claude/test\n---\nA`,
      'b.md': `---\ntags:\n  - Claude/test\n---\nB`,
      'c.md': `---\ntags:\n  - Claude/test/wap\n---\nC`,
      'd.md': `---\ntags:\n  - other\n---\nD`,
    }
    const writes: string[] = []
    const result = await renameTagInFiles(
      ['a.md', 'b.md', 'c.md', 'd.md'],
      'claude/test',
      'Claude/test1',
      {
        read: (p) => Promise.resolve(files[p]),
        write: (p, content) => {
          files[p] = content
          writes.push(p)
          return Promise.resolve()
        },
      },
    )
    expect(result).toEqual({ changed: 3, failed: 0 })
    expect(writes.sort()).toEqual(['a.md', 'b.md', 'c.md']) // d.md untouched
    expect(files['a.md']).toContain('Claude/test1')
    expect(files['b.md']).toContain('Claude/test1')
    expect(files['c.md']).toContain('Claude/test1/wap')
  })

  it('counts failures and keeps going', async () => {
    const result = await renameTagInFiles(['x.md', 'y.md'], 'test', 'exam', {
      read: (p) =>
        p === 'x.md'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve('---\ntags:\n  - test\n---\n'),
      write: () => Promise.resolve(),
    })
    expect(result).toEqual({ changed: 1, failed: 1 })
  })
})

describe('moveTagUnderTarget', () => {
  it('uses the leaf segment under the target', () => {
    expect(moveTagUnderTarget('test', 'project')).toBe('project/test')
    expect(moveTagUnderTarget('a/b', 'c')).toBe('c/b')
    expect(moveTagUnderTarget('claude/test/wap', 'archive')).toBe('archive/wap')
  })
})

describe('promoteTagOneLevel', () => {
  it('removes the immediate parent while preserving higher ancestors and label casing', () => {
    expect(promoteTagOneLevel('Project/Frontend/React')).toBe('Project/React')
    expect(promoteTagOneLevel('Project/Frontend')).toBe('Frontend')
  })

  it('does not promote a top-level tag', () => {
    expect(promoteTagOneLevel('Project')).toBeNull()
  })
})
