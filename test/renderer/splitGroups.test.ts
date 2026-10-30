import { describe, expect, it } from 'vitest'
import {
  canSplitRight,
  groupsFromSaved,
  moveTab,
  neighborInGroup,
  normalizeGroups,
  replaceTabId,
  resizeAdjacent,
  savedSplitOf,
  splitRight,
  unsplit,
  type SplitGroup,
  type SplitLayout
} from '@renderer/main-window/splitGroups'

function group(id: string, ...tabIds: string[]): SplitGroup {
  return { id, panes: tabIds.map((tabId) => ({ tabId, weight: 1 })) }
}

function members(layout: SplitLayout): string[][] {
  return layout.groups.map((g) => g.panes.map((p) => p.tabId))
}

describe('splitRight', () => {
  it('単独のタブの右に加えて、2つのグループを作る', () => {
    const next = splitRight({ order: ['a', 'b', 'c'], groups: [] }, 'a', 'c')
    expect(next.order).toEqual(['a', 'c', 'b'])
    expect(members(next)).toEqual([['a', 'c']])
  })

  it('表示中のグループの右端に加え、幅は既存の平均にする', () => {
    const layout: SplitLayout = {
      order: ['a', 'b', 'x', 'c'],
      groups: [{ id: 'g', panes: [{ tabId: 'a', weight: 100 }, { tabId: 'b', weight: 300 }] }]
    }
    const next = splitRight(layout, 'a', 'c')
    expect(next.order).toEqual(['a', 'b', 'c', 'x'])
    expect(next.groups[0]!.panes).toEqual([
      { tabId: 'a', weight: 100 },
      { tabId: 'b', weight: 300 },
      { tabId: 'c', weight: 200 }
    ])
  })

  it('別のグループのタブは、そのグループから抜けて移る', () => {
    const layout: SplitLayout = { order: ['a', 'b', 'c', 'd'], groups: [group('g1', 'a', 'b'), group('g2', 'c', 'd')] }
    const next = splitRight(layout, 'a', 'd')
    expect(next.order).toEqual(['a', 'b', 'd', 'c'])
    expect(members(next)).toEqual([['a', 'b', 'd']])
  })

  it('4つのグループには加えない', () => {
    const layout: SplitLayout = { order: ['a', 'b', 'c', 'd', 'e'], groups: [group('g', 'a', 'b', 'c', 'd')] }
    expect(canSplitRight(layout.groups, 'b', 'e')).toBe(false)
    expect(splitRight(layout, 'b', 'e')).toBe(layout)
  })

  it('表示中のタブ自身・表示中のグループのタブは加えない', () => {
    const groups = [group('g', 'a', 'b')]
    expect(canSplitRight(groups, 'a', 'a')).toBe(false)
    expect(canSplitRight(groups, 'a', 'b')).toBe(false)
    expect(canSplitRight(groups, null, 'b')).toBe(false)
  })
})

describe('unsplit', () => {
  it('グループのすぐ右の単独のタブにする', () => {
    const layout: SplitLayout = { order: ['a', 'b', 'c', 'x'], groups: [group('g', 'a', 'b', 'c')] }
    const next = unsplit(layout, 'a')
    expect(next.order).toEqual(['b', 'c', 'a', 'x'])
    expect(members(next)).toEqual([['b', 'c']])
  })

  it('残りが1つになったらグループを解く', () => {
    const next = unsplit({ order: ['a', 'b'], groups: [group('g', 'a', 'b')] }, 'b')
    expect(next.order).toEqual(['a', 'b'])
    expect(next.groups).toEqual([])
  })
})

describe('moveTab', () => {
  const layout: SplitLayout = { order: ['x', 'a', 'b', 'c', 'y'], groups: [group('g', 'a', 'b', 'c')] }

  it('グループの中で動かすとペインの並びが変わる', () => {
    const next = moveTab(layout, 'a', 'y')
    expect(next.order).toEqual(['x', 'b', 'c', 'a', 'y'])
    expect(members(next)).toEqual([['b', 'c', 'a']])
  })

  it('グループの外へ動かすとグループから外れる', () => {
    const next = moveTab(layout, 'c', null)
    expect(next.order).toEqual(['x', 'a', 'b', 'y', 'c'])
    expect(members(next)).toEqual([['a', 'b']])
  })

  it('グループに入っていないタブをペインの間に落とすと、グループのすぐ右へ送る', () => {
    const next = moveTab(layout, 'x', 'b')
    expect(next.order).toEqual(['a', 'b', 'c', 'x', 'y'])
    expect(members(next)).toEqual([['a', 'b', 'c']])
  })

  it('並びが変わらなければ同じものを返す', () => {
    expect(moveTab(layout, 'a', 'b')).toBe(layout)
  })
})

describe('normalizeGroups', () => {
  it('閉じたタブを外し、1つになったグループを解く', () => {
    const groups = [group('g1', 'a', 'b'), group('g2', 'c', 'd', 'e')]
    expect(normalizeGroups(groups, ['a', 'c', 'e']).map((g) => g.panes.map((p) => p.tabId))).toEqual([['c', 'e']])
  })

  it('変化がなければ同じ配列を返す', () => {
    const groups = [group('g', 'a', 'b')]
    expect(normalizeGroups(groups, ['a', 'b', 'c'])).toBe(groups)
  })
})

describe('resizeAdjacent', () => {
  it('右のペインを縮めて左を広げ、最小幅で止める', () => {
    expect(resizeAdjacent({ width: 400, minWidth: 240 }, { width: 400, minWidth: 320 }, 100)).toEqual({ left: 480, right: 320 })
    expect(resizeAdjacent({ width: 400, minWidth: 240 }, { width: 400, minWidth: 240 }, -300)).toEqual({ left: 240, right: 560 })
  })
})

describe('保存と復元', () => {
  it('グループ番号と比率から開き直し、無くなったタブは外す', () => {
    const groups = [
      { id: 'g1', panes: [{ tabId: 'a', weight: 320.456 }, { tabId: 'b', weight: 500 }] },
      group('g2', 'c', 'd')
    ]
    const saved = savedSplitOf(groups)
    expect(saved.get('a')).toEqual({ group: 0, weight: 320.46 })
    const restored = groupsFromSaved(['a', 'b', 'd'], saved)
    expect(restored.map((g) => g.panes)).toEqual([
      [
        { tabId: 'a', weight: 320.46 },
        { tabId: 'b', weight: 500 }
      ]
    ])
  })
})

describe('replaceTabId / neighborInGroup', () => {
  it('グループの中の id を差し替える', () => {
    const groups = [group('g', 'connecting:1', 'b')]
    expect(replaceTabId(groups, 'connecting:1', 's1')[0]!.panes.map((p) => p.tabId)).toEqual(['s1', 'b'])
    expect(replaceTabId(groups, 'x', 'y')).toBe(groups)
  })

  it('閉じたタブの左隣、無ければ右隣を返す', () => {
    const groups = [group('g', 'a', 'b', 'c')]
    expect(neighborInGroup(groups, 'b')).toBe('a')
    expect(neighborInGroup(groups, 'a')).toBe('b')
    expect(neighborInGroup(groups, 'z')).toBeUndefined()
  })
})
