import { describe, expect, it } from 'vitest'
import { reorderFavoritePaths } from './favorites'

describe('reorderFavoritePaths', () => {
  const order = ['/a', '/b', '/c', '/d']

  it('moves an item down to sit after its drop target', () => {
    expect(reorderFavoritePaths(order, '/a', '/c')).toEqual(['/b', '/c', '/a', '/d'])
  })

  it('moves an item up to sit before its drop target', () => {
    expect(reorderFavoritePaths(order, '/d', '/b')).toEqual(['/a', '/d', '/b', '/c'])
  })

  it('keeps neighbours intact when swapping adjacent items', () => {
    expect(reorderFavoritePaths(order, '/b', '/c')).toEqual(['/a', '/c', '/b', '/d'])
    expect(reorderFavoritePaths(order, '/c', '/b')).toEqual(['/a', '/c', '/b', '/d'])
  })

  it('is a no-op for a self drop or an unknown path', () => {
    expect(reorderFavoritePaths(order, '/b', '/b')).toEqual(order)
    expect(reorderFavoritePaths(order, '/zz', '/b')).toEqual(order)
    expect(reorderFavoritePaths(order, '/b', '/zz')).toEqual(order)
  })

  it('never mutates the input', () => {
    const input = [...order]
    reorderFavoritePaths(input, '/a', '/d')
    expect(input).toEqual(order)
  })
})
