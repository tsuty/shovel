import { describe, expect, it } from 'vitest'
import {
  activateTab,
  canSplitRight,
  focusedTabId,
  layoutFromSaved,
  moveTab,
  normalizeLayout,
  removeTab,
  replaceTabId,
  resizeAdjacent,
  savedPanesOf,
  splitRight,
  type PaneLayout
} from '@renderer/main-window/paneLayout'

function layout(...panes: [string, string[], string | null, number?][]): PaneLayout {
  return {
    panes: panes.map(([id, tabIds, activeTabId, weight]) => ({ id, tabIds, activeTabId, weight: weight ?? 1 })),
    focusedPaneId: panes[0]![0]
  }
}

function shape(l: PaneLayout): string[] {
  return l.panes.map((p) => `${p.id}:${p.tabIds.map((id) => (id === p.activeTabId ? `*${id}` : id)).join(',')}`)
}

describe('splitRight', () => {
  it('ペインを半分に分け、タブを右の新しいペインへ移して前面にする', () => {
    const l = { ...layout(['A', ['a', 'b', 'c'], 'b', 2], ['B', ['x'], 'x']), focusedPaneId: 'A' }
    const next = splitRight(l, 'b', 'N')
    expect(shape(next)).toEqual(['A:a,*c', 'N:*b', 'B:*x'])
    expect(next.panes.map((p) => p.weight)).toEqual([1, 1, 1])
    expect(next.focusedPaneId).toBe('N')
  })

  it('タブが1つしかないペインと、ペインが4つのときは分割しない', () => {
    const single = layout(['A', ['a'], 'a'])
    expect(canSplitRight(single, 'a')).toBe(false)
    expect(splitRight(single, 'a')).toBe(single)
    const full = layout(['A', ['a', 'b'], 'a'], ['B', ['c'], 'c'], ['C', ['d'], 'd'], ['D', ['e'], 'e'])
    expect(canSplitRight(full, 'a')).toBe(false)
  })
})

describe('removeTab', () => {
  it('前面のタブを閉じたら右隣（無ければ左隣）を前面にする', () => {
    expect(shape(removeTab(layout(['A', ['a', 'b', 'c'], 'b']), 'b'))).toEqual(['A:a,*c'])
    expect(shape(removeTab(layout(['A', ['a', 'b', 'c'], 'c']), 'c'))).toEqual(['A:a,*b'])
  })

  it('ペインが空になったら畳み、幅を左隣に渡して前面にする', () => {
    const l = { ...layout(['A', ['a'], 'a', 1], ['B', ['b'], 'b', 2], ['C', ['c'], 'c', 3]), focusedPaneId: 'B' }
    const next = removeTab(l, 'b')
    expect(shape(next)).toEqual(['A:*a', 'C:*c'])
    expect(next.panes.map((p) => p.weight)).toEqual([3, 3])
    expect(next.focusedPaneId).toBe('A')
  })

  it('左端のペインが空になったら右隣に幅を渡す', () => {
    const next = removeTab(layout(['A', ['a'], 'a', 1], ['B', ['b'], 'b', 1]), 'a')
    expect(shape(next)).toEqual(['B:*b'])
    expect(next.panes[0]!.weight).toBe(2)
    expect(next.focusedPaneId).toBe('B')
  })

  it('最後のペインは空でも残す', () => {
    expect(shape(removeTab(layout(['A', ['a'], 'a']), 'a'))).toEqual(['A:'])
  })
})

describe('moveTab', () => {
  it('同じペインの中で並べ替えて前面にする', () => {
    const next = moveTab(layout(['A', ['a', 'b', 'c'], 'a']), 'a', 'A', null)
    expect(shape(next)).toEqual(['A:b,c,*a'])
  })

  it('別のペインへ移し、移した先を前面のペインにする', () => {
    const next = moveTab(layout(['A', ['a', 'b'], 'a'], ['B', ['x', 'y'], 'x']), 'a', 'B', 'y')
    expect(shape(next)).toEqual(['A:*b', 'B:x,*a,y'])
    expect(next.focusedPaneId).toBe('B')
  })

  it('元のペインが空になったら畳む', () => {
    const next = moveTab(layout(['A', ['a'], 'a', 1], ['B', ['x'], 'x', 1]), 'a', 'B', null)
    expect(shape(next)).toEqual(['B:x,*a'])
    expect(next.panes[0]!.weight).toBe(2)
  })

  it('動かないときは同じものを返す', () => {
    const l = layout(['A', ['a', 'b'], 'b'])
    expect(moveTab(l, 'b', 'A', null)).toBe(l)
  })
})

describe('activateTab / normalizeLayout / replaceTabId', () => {
  it('開いているタブはそのペインで前面にし、無ければ前面のペインに足す', () => {
    const l = { ...layout(['A', ['a'], 'a'], ['B', ['b'], 'b']), focusedPaneId: 'B' }
    expect(activateTab(l, 'a').focusedPaneId).toBe('A')
    expect(shape(activateTab(l, 'n'))).toEqual(['A:*a', 'B:b,*n'])
    expect(shape(activateTab(l, 'n', 'A'))).toEqual(['A:a,*n', 'B:*b'])
  })

  it('無くなったタブを外し、どこにも無いタブを前面のペインに足す', () => {
    const l = { ...layout(['A', ['a', 'gone'], 'gone'], ['B', ['b'], 'b']), focusedPaneId: 'B' }
    expect(shape(normalizeLayout(l, ['a', 'b', 'new']))).toEqual(['A:*a', 'B:*b,new'])
  })

  it('変化がなければ同じものを返す', () => {
    const l = layout(['A', ['a'], 'a'])
    expect(normalizeLayout(l, ['a'])).toBe(l)
  })

  it('タブ id を差し替える', () => {
    const next = replaceTabId(layout(['A', ['connecting:1', 'b'], 'connecting:1']), 'connecting:1', 's1')
    expect(shape(next)).toEqual(['A:*s1,b'])
    expect(focusedTabId(next)).toBe('s1')
  })
})

describe('resizeAdjacent', () => {
  it('右のペインを縮めて左を広げ、最小幅で止める', () => {
    expect(resizeAdjacent({ width: 400, minWidth: 240 }, { width: 400, minWidth: 320 }, 100)).toEqual({ left: 480, right: 320 })
    expect(resizeAdjacent({ width: 400, minWidth: 240 }, { width: 400, minWidth: 240 }, -300)).toEqual({ left: 240, right: 560 })
  })
})

describe('保存と復元', () => {
  it('ペインの構成・幅・前面のタブを開き直す', () => {
    const l = { ...layout(['A', ['a', 'b'], 'b', 1.234], ['B', ['c'], 'c', 2]), focusedPaneId: 'B' }
    const saved = savedPanesOf(l)
    expect(saved.get('a')).toEqual({ index: 0, weight: 1.23 })
    expect(saved.get('c')).toEqual({ index: 1, weight: 2, active: true, focused: true })
    const restored = layoutFromSaved(['a', 'b', 'c', 'd'], saved)
    expect(restored.panes.map((p) => [p.tabIds, p.activeTabId, p.weight])).toEqual([
      [['a', 'b', 'd'], 'b', 1.23],
      [['c'], 'c', 2]
    ])
    expect(restored.focusedPaneId).toBe(restored.panes[1]!.id)
  })

  it('開き直せなかったタブのペインは作らない', () => {
    const saved = new Map([['c', { index: 1, weight: 1, active: true }]])
    const restored = layoutFromSaved(['a'], saved)
    expect(restored.panes.map((p) => p.tabIds)).toEqual([['a']])
  })
})
