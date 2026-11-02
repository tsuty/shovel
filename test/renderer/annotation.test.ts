import { describe, expect, it } from 'vitest'
import {
  EMPTY_HISTORY,
  annotationUnit,
  arrowGeometry,
  boxFromPoints,
  commit,
  constrainPoint,
  distanceToSegment,
  hitTest,
  isDrawable,
  outlineColor,
  redo,
  shapeBounds,
  textBox,
  topmostHit,
  translateShape,
  undo,
  type Annotation,
  type MeasureText,
  type StrokeShape,
  type TextShape
} from '@renderer/main-window/annotation'

/** 1 文字を文字の大きさの半分の幅とみなす。 */
const measure: MeasureText = (line, fontSize) => line.length * fontSize * 0.5

function stroke(kind: StrokeShape['kind'], from: [number, number], to: [number, number], id: string = kind): StrokeShape {
  return { id, kind, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, color: '#ef4444', width: 4 }
}

function text(value: string, at: [number, number] = [10, 20], id = 'text'): TextShape {
  return { id, kind: 'text', at: { x: at[0], y: at[1] }, text: value, color: '#ef4444', fontSize: 20 }
}

describe('annotationUnit', () => {
  it('小さい画像は 1、大きい画像は長辺に比例する', () => {
    expect(annotationUnit(800, 600)).toBe(1)
    expect(annotationUnit(2400, 1600)).toBe(2)
    expect(annotationUnit(1000, 3600)).toBe(3)
  })
})

describe('boxFromPoints', () => {
  it('どちら向きに描いても左上と幅・高さにする', () => {
    expect(boxFromPoints({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 })
  })
})

describe('constrainPoint', () => {
  it('矩形・楕円は正方形・正円にする（向きは保つ）', () => {
    expect(constrainPoint('rect', { x: 0, y: 0 }, { x: 10, y: -30 })).toEqual({ x: 30, y: -30 })
    expect(constrainPoint('ellipse', { x: 5, y: 5 }, { x: -15, y: 10 })).toEqual({ x: -15, y: 25 })
  })
  it('矢印は 45° 刻みの向きにし、長さは保つ', () => {
    const end = constrainPoint('arrow', { x: 0, y: 0 }, { x: 100, y: 10 })
    expect(end.x).toBeCloseTo(Math.hypot(100, 10))
    expect(end.y).toBeCloseTo(0)
    const diagonal = constrainPoint('arrow', { x: 0, y: 0 }, { x: 50, y: 45 })
    expect(diagonal.x).toBeCloseTo(diagonal.y)
  })
})

describe('isDrawable', () => {
  it('ほとんど動かしていないドラッグは図形にしない', () => {
    expect(isDrawable({ x: 0, y: 0 }, { x: 1, y: 2 })).toBe(false)
    expect(isDrawable({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true)
  })
})

describe('arrowGeometry', () => {
  it('矢じりの先端は終点にあり、軸は矢じりの中で止まる', () => {
    const { shaftEnd, head } = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)
    expect(head[0]).toEqual({ x: 100, y: 0 })
    // 矢じりの長さは太さ × 4 = 16、幅の半分はその 0.55 倍。
    expect(head[1].x).toBeCloseTo(84)
    expect(Math.abs(head[1].y)).toBeCloseTo(8.8)
    expect(head[1].y).toBeCloseTo(-head[2].y)
    expect(shaftEnd.x).toBeGreaterThan(84)
    expect(shaftEnd.x).toBeLessThan(100)
    expect(shaftEnd.y).toBeCloseTo(0)
  })
  it('短い矢印では矢じりを長さに収める', () => {
    const { head } = arrowGeometry({ x: 0, y: 0 }, { x: 5, y: 0 }, 8)
    expect(head[1].x).toBeCloseTo(0)
  })
  it('長さ 0 でも壊れない', () => {
    const { shaftEnd, head } = arrowGeometry({ x: 3, y: 3 }, { x: 3, y: 3 }, 4)
    expect(shaftEnd).toEqual({ x: 3, y: 3 })
    expect(head.every((p) => p.x === 3 && p.y === 3)).toBe(true)
  })
})

describe('distanceToSegment', () => {
  it('線分への垂線の長さ、端の外では端点までの距離', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
  })
})

describe('hitTest', () => {
  it('矩形は辺の近くだけ当たり、中は当たらない', () => {
    const rect = stroke('rect', [0, 0], [100, 50])
    expect(hitTest(rect, { x: 50, y: 1 }, 4, measure)).toBe(true)
    expect(hitTest(rect, { x: 99, y: 25 }, 4, measure)).toBe(true)
    expect(hitTest(rect, { x: 50, y: 25 }, 4, measure)).toBe(false)
  })
  it('楕円は周の近くだけ当たる', () => {
    const ellipse = stroke('ellipse', [0, 0], [100, 50])
    expect(hitTest(ellipse, { x: 100, y: 25 }, 4, measure)).toBe(true)
    expect(hitTest(ellipse, { x: 50, y: 0 }, 4, measure)).toBe(true)
    expect(hitTest(ellipse, { x: 50, y: 25 }, 4, measure)).toBe(false)
    expect(hitTest(ellipse, { x: 2, y: 2 }, 4, measure)).toBe(false)
  })
  it('矢印は軸の近くで当たる', () => {
    const arrow = stroke('arrow', [0, 0], [100, 100])
    expect(hitTest(arrow, { x: 52, y: 48 }, 4, measure)).toBe(true)
    expect(hitTest(arrow, { x: 70, y: 30 }, 4, measure)).toBe(false)
  })
  it('文字は外接矩形の中で当たる', () => {
    const shape = text('abcd\nef')
    // 幅は 4 文字 × 10 = 40、高さは 2 行 × 20 × 1.25 = 50。
    expect(textBox(shape, measure)).toEqual({ x: 10, y: 20, width: 40, height: 50 })
    expect(hitTest(shape, { x: 45, y: 60 }, 0, measure)).toBe(true)
    expect(hitTest(shape, { x: 55, y: 60 }, 0, measure)).toBe(false)
  })
})

describe('topmostHit', () => {
  it('重なっているときは手前（後ろの要素）を返す', () => {
    const shapes: Annotation[] = [stroke('rect', [0, 0], [100, 100], 'back'), stroke('arrow', [0, 0], [100, 0], 'front')]
    expect(topmostHit(shapes, { x: 50, y: 0 }, 4, measure)?.id).toBe('front')
    expect(topmostHit(shapes, { x: 0, y: 50 }, 4, measure)?.id).toBe('back')
    expect(topmostHit(shapes, { x: 50, y: 50 }, 4, measure)).toBeNull()
  })
})

describe('translateShape', () => {
  it('2 点の図形は両端を、文字は位置をずらす', () => {
    expect(translateShape(stroke('arrow', [0, 0], [10, 10]), 5, -2)).toMatchObject({
      from: { x: 5, y: -2 },
      to: { x: 15, y: 8 }
    })
    expect(translateShape(text('a'), 1, 2).at).toEqual({ x: 11, y: 22 })
  })
})

describe('shapeBounds', () => {
  it('線の太さの分だけ広げる', () => {
    expect(shapeBounds(stroke('rect', [10, 10], [20, 20]), measure)).toEqual({ x: 8, y: 8, width: 14, height: 14 })
  })
})

describe('outlineColor', () => {
  it('白い文字は黒で、それ以外は白で縁取る', () => {
    expect(outlineColor('#FFFFFF')).toBe('#111827')
    expect(outlineColor('#ef4444')).toBe('#ffffff')
  })
})

describe('履歴', () => {
  const a = stroke('rect', [0, 0], [1, 1], 'a')
  const b = stroke('ellipse', [0, 0], [1, 1], 'b')

  it('元に戻す・やり直す', () => {
    const one = commit(EMPTY_HISTORY, [a])
    const two = commit(one, [a, b])
    const back = undo(two)
    expect(back.present).toEqual([a])
    expect(undo(back).present).toEqual([])
    expect(redo(back).present).toEqual([a, b])
  })
  it('新しい変更でやり直しの履歴を捨てる', () => {
    const back = undo(commit(commit(EMPTY_HISTORY, [a]), [a, b]))
    const branched = commit(back, [b])
    expect(branched.future).toEqual([])
    expect(redo(branched)).toBe(branched)
  })
  it('戻す先が無ければそのまま', () => {
    expect(undo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY)
    expect(redo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY)
  })
  it('同じ並びを渡しても履歴を増やさない', () => {
    const one = commit(EMPTY_HISTORY, [a])
    expect(commit(one, one.present)).toBe(one)
  })
})
