import { findTextMatches } from '@renderer/main-window/findInPage'

describe('findTextMatches', () => {
  it('空の検索語は何もヒットしない', () => {
    expect(findTextMatches(['abc'], '')).toEqual([])
  })

  it('大文字小文字を区別しない', () => {
    expect(findTextMatches(['Apple apple APPLE'], 'apple')).toHaveLength(3)
  })

  it('重ならないように数える', () => {
    expect(findTextMatches(['aaaa'], 'aa')).toHaveLength(2)
  })

  it('ノードをまたぐ語も見つけ、位置をノード内に戻す', () => {
    expect(findTextMatches(['const fo', 'o', 'bar = 1'], 'foobar')).toEqual([
      { start: { segment: 0, offset: 6 }, end: { segment: 2, offset: 3 } }
    ])
  })

  it('ノードの境目は、始点なら後ろのノード、終点なら前のノードに寄せる', () => {
    expect(findTextMatches(['ab', '', 'cd'], 'cd')).toEqual([
      { start: { segment: 2, offset: 0 }, end: { segment: 2, offset: 2 } }
    ])
    expect(findTextMatches(['ab', '', 'cd'], 'ab')).toEqual([
      { start: { segment: 0, offset: 0 }, end: { segment: 0, offset: 2 } }
    ])
  })

  it('日本語もそのまま探せる', () => {
    expect(findTextMatches(['検索の', '検索'], '検索')).toHaveLength(2)
  })
})
