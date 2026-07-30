import { describe, expect, it } from 'vitest'
import { compareVersions } from './versionComparison'

describe('compareVersions', () => {
  it('orders numeric version segments instead of comparing them as text', () => {
    expect(compareVersions('2.0.30', '2.0.29')).toBeGreaterThan(0)
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.29', '2.0.30')).toBeLessThan(0)
  })

  it('orders prereleases below their matching stable release', () => {
    expect(compareVersions('2.0.30', '2.0.30-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('2.0.30-rc.1', '2.0.30')).toBeLessThan(0)
  })

  it('does not classify an invalid release tag as an upgrade or rollback', () => {
    expect(compareVersions('next', '2.0.29')).toBe(0)
  })
})
