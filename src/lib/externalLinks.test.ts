import { describe, expect, it } from 'vitest'
import { classifyExternalLink } from './externalLinks'

describe('external link policy', () => {
  it('trusts only exact official hosts and account path prefixes', () => {
    expect(classifyExternalLink('https://github.com/AttackingXiang/xiangzi-md').kind).toBe('trusted')
    expect(classifyExternalLink('https://github.com.evil.test/AttackingXiang/').kind).toBe('confirm')
    expect(classifyExternalLink('https://github.com/AttackingXiang-evil/repo').kind).toBe('confirm')
  })

  it('requires confirmation for arbitrary HTTPS and blocks unsafe URL forms', () => {
    expect(classifyExternalLink('https://example.com/page')).toMatchObject({
      kind: 'confirm',
      hostname: 'example.com',
    })
    expect(classifyExternalLink('http://example.com/page').kind).toBe('blocked')
    expect(classifyExternalLink('https://user@example.com/page').kind).toBe('blocked')
    expect(classifyExternalLink('javascript:alert(1)').kind).toBe('blocked')
  })
})
