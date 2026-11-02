import { describe, expect, it } from 'vitest'
import {
  EMPTY_HISTORY,
  annotationUnit,
  arrowGeometry,
  boxFromPoints,
  clampOffset,
  commit,
  constrainPoint,
  cornerRadius,
  dashPattern,
  distanceToSegment,
  drawOrder,
  findCrop,
  handleAt,
  handleCursor,
  handlePoints,
  hitTest,
  isDrawable,
  mosaicBlockSize,
  outlineColor,
  pixelBox,
  pixelate,
  redo,
  replaceCrop,
  resizeShape,
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
  return { id, kind, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, color: '#ef4444', width: 4, dash: 'solid' }
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

describe('モザイク・切り抜き', () => {
  const mosaic = { id: 'm', kind: 'mosaic', from: { x: 10, y: 10 }, to: { x: 50, y: 30 }, level: 1 } as const
  const crop = { id: 'c', kind: 'crop', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } } as const

  it('モザイクは範囲の中で当たり、切り抜きは当たらない', () => {
    expect(hitTest(mosaic, { x: 30, y: 20 }, 0, measure)).toBe(true)
    expect(hitTest(mosaic, { x: 60, y: 20 }, 0, measure)).toBe(false)
    expect(hitTest(crop, { x: 50, y: 50 }, 0, measure)).toBe(false)
  })
  it('範囲の外接矩形は範囲そのもの', () => {
    expect(shapeBounds(mosaic, measure)).toEqual({ x: 10, y: 10, width: 40, height: 20 })
  })
  it('切り抜きは並びに 1 つだけ', () => {
    const a = stroke('rect', [0, 0], [1, 1], 'a')
    const withCrop = replaceCrop([a], crop)
    expect(findCrop(withCrop)).toBe(crop)
    const replaced = replaceCrop(withCrop, { ...crop, id: 'c2' })
    expect(replaced.filter((shape) => shape.kind === 'crop').map((shape) => shape.id)).toEqual(['c2'])
    expect(findCrop(replaceCrop(replaced, null))).toBeNull()
  })
  it('描く順はモザイクが先で、切り抜きは描かない', () => {
    const a = stroke('rect', [0, 0], [1, 1], 'a')
    expect(drawOrder([a, crop, mosaic]).map((shape) => shape.id)).toEqual(['m', 'a'])
  })
})

describe('pixelBox', () => {
  it('整数のピクセルに広げ、画像の中に収める', () => {
    expect(pixelBox({ x: 1.5, y: -3, width: 10, height: 5.2 }, 100, 100)).toEqual({ x: 1, y: 0, width: 11, height: 3 })
    expect(pixelBox({ x: 95.2, y: 0, width: 10, height: 10 }, 100, 100)).toEqual({ x: 95, y: 0, width: 5, height: 10 })
  })
  it('round は四捨五入し、位置の端数で大きさが変わらない', () => {
    expect(pixelBox({ x: 1.4, y: 2.6, width: 10, height: 5 }, 100, 100, 'round')).toEqual({ x: 1, y: 3, width: 10, height: 5 })
    expect(pixelBox({ x: 1.6, y: 2.4, width: 10.5, height: 5.2 }, 100, 100, 'round')).toEqual({ x: 2, y: 2, width: 11, height: 5 })
    expect(pixelBox({ x: 1.4, y: 2.4, width: 10.5, height: 5.2 }, 100, 100, 'round')).toEqual({ x: 1, y: 2, width: 11, height: 5 })
  })
})

describe('clampOffset', () => {
  it('矩形が画像からはみ出ない量に抑える', () => {
    const box = { x: 10, y: 10, width: 30, height: 20 }
    expect(clampOffset(box, -50, 5, 100, 100)).toEqual({ x: -10, y: 5 })
    expect(clampOffset(box, 80, 90, 100, 100)).toEqual({ x: 60, y: 70 })
  })
})

describe('mosaicBlockSize', () => {
  it('細かさの段階ごとの大きさで、大きい画像は長辺に比例する', () => {
    expect([0, 1, 2].map((level) => mosaicBlockSize(900, 560, level))).toEqual([5, 8, 12])
    expect([0, 1, 2].map((level) => mosaicBlockSize(2400, 1500, level))).toEqual([10, 16, 24])
  })
  it('範囲外の段階は端の段階にする', () => {
    expect(mosaicBlockSize(900, 560, -1)).toBe(5)
    expect(mosaicBlockSize(900, 560, 9)).toBe(12)
  })
})

describe('pixelate', () => {
  it('各マスをその平均の色で塗る（端の半端なマスも）', () => {
    // 3×2 の画像を 2px のマスに分ける: 左は 2×2、右は 1×2。
    const px = (r: number): number[] => [r, 0, 0, 255]
    const data = new Uint8ClampedArray([...px(0), ...px(100), ...px(40), ...px(200), ...px(100), ...px(80)])
    const out = pixelate(data, 3, 2, 2)
    expect(Array.from({ length: 6 }, (_, i) => out[i * 4])).toEqual([100, 100, 60, 100, 100, 60])
    expect(out[3]).toBe(255)
  })
  it('元の配列は変えない', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    pixelate(data, 2, 1, 2)
    expect(Array.from(data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
  })
})

describe('つまみ', () => {
  it('矩形などは四隅と各辺の中点、矢印は両端、文字は無し', () => {
    expect(handlePoints(stroke('rect', [10, 20], [30, 60])).map((h) => `${h.handle}:${h.point.x},${h.point.y}`)).toEqual([
      'nw:10,20',
      'n:20,20',
      'ne:30,20',
      'e:30,40',
      'se:30,60',
      's:20,60',
      'sw:10,60',
      'w:10,40'
    ])
    expect(handlePoints(stroke('arrow', [0, 0], [5, 5])).map((h) => h.handle)).toEqual(['from', 'to'])
    expect(handlePoints(text('a'))).toEqual([])
  })
  it('描いた向きによらず、見た目の位置でつまみを呼ぶ', () => {
    const drawnUpLeft = stroke('ellipse', [30, 60], [10, 20])
    expect(handleAt(drawnUpLeft, { x: 11, y: 21 }, 3)).toBe('nw')
    expect(handleAt(drawnUpLeft, { x: 20, y: 30 }, 3)).toBeNull()
  })
  it('短い矢印で両端が重なるときは先端を取る', () => {
    expect(handleAt(stroke('arrow', [0, 0], [2, 0]), { x: 1, y: 0 }, 3)).toBe('to')
  })
  it('ポインタの形', () => {
    expect(['nw', 'n', 'ne', 'e', 'from'].map((h) => handleCursor(h as Parameters<typeof handleCursor>[0]))).toEqual([
      'nwse-resize',
      'ns-resize',
      'nesw-resize',
      'ew-resize',
      'crosshair'
    ])
  })
})

describe('resizeShape', () => {
  const rect = stroke('rect', [10, 10], [50, 30])
  const box = (shape: Annotation): ReturnType<typeof boxFromPoints> =>
    'from' in shape ? boxFromPoints(shape.from, shape.to) : boxFromPoints({ x: 0, y: 0 }, { x: 0, y: 0 })

  it('隅は反対の隅を動かさない', () => {
    expect(box(resizeShape(rect, 'se', { x: 70, y: 50 }, false))).toEqual({ x: 10, y: 10, width: 60, height: 40 })
    expect(box(resizeShape(rect, 'nw', { x: 0, y: 5 }, false))).toEqual({ x: 0, y: 5, width: 50, height: 25 })
  })
  it('辺は幅か高さだけを変える', () => {
    expect(box(resizeShape(rect, 'e', { x: 80, y: 999 }, false))).toEqual({ x: 10, y: 10, width: 70, height: 20 })
    expect(box(resizeShape(rect, 'n', { x: 999, y: 0 }, false))).toEqual({ x: 10, y: 0, width: 40, height: 30 })
  })
  it('反対側を越えると裏返る', () => {
    expect(box(resizeShape(rect, 'w', { x: 60, y: 0 }, false))).toEqual({ x: 50, y: 10, width: 10, height: 20 })
  })
  it('Shift で隅を動かすと正方形', () => {
    expect(box(resizeShape(rect, 'se', { x: 70, y: 20 }, true))).toEqual({ x: 10, y: 10, width: 60, height: 60 })
  })
  it('矢印は動かした端だけが変わり、Shift で 45° 刻み', () => {
    const arrow = stroke('arrow', [0, 0], [100, 0])
    expect(resizeShape(arrow, 'to', { x: 50, y: 40 }, false)).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 50, y: 40 } })
    const moved = resizeShape(arrow, 'from', { x: 90, y: 60 }, true)
    expect(moved.to).toEqual({ x: 100, y: 0 })
    expect(moved.from.x).toBeCloseTo(100)
  })
  it('文字は変えない', () => {
    const shape = text('a')
    expect(resizeShape(shape, 'se', { x: 99, y: 99 }, false)).toBe(shape)
  })
})

describe('dashPattern', () => {
  it('実線は空、破線・点線は太さに比例する', () => {
    expect(dashPattern('solid', 4)).toEqual([])
    expect(dashPattern('dashed', 4)).toEqual([8, 12])
    expect(dashPattern('dotted', 4)).toEqual([0, 8])
  })
})

describe('cornerRadius', () => {
  it('太さの 2 倍で、短い辺の半分を超えない', () => {
    expect(cornerRadius(4, { x: 0, y: 0, width: 100, height: 50 })).toBe(8)
    expect(cornerRadius(8, { x: 0, y: 0, width: 100, height: 10 })).toBe(5)
  })
})
