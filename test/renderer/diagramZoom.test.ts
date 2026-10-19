import { clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, parseViewBox, stepZoom, wheelZoom } from '@renderer/shared/lib/diagramZoom'

describe('parseViewBox', () => {
  it('幅と高さを取る（空白・カンマ区切り）', () => {
    expect(parseViewBox('-8 -8 400 300')).toEqual({ width: 400, height: 300 })
    expect(parseViewBox('0,0,120.5,80')).toEqual({ width: 120.5, height: 80 })
  })
  it('読めないものは null', () => {
    expect(parseViewBox(null)).toBeNull()
    expect(parseViewBox('0 0 100')).toBeNull()
    expect(parseViewBox('0 0 0 100')).toBeNull()
    expect(parseViewBox('0 0 abc 100')).toBeNull()
  })
})

describe('fitZoom', () => {
  const natural = { width: 2000, height: 1000 }
  it('幅に合わせる: 高さは見ない', () => {
    expect(fitZoom('fitWidth', natural, { width: 1000, height: 100 })).toBe(0.5)
  })
  it('全体を表示: 幅と高さの小さいほうに合わせる', () => {
    expect(fitZoom('fitAll', natural, { width: 1000, height: 100 })).toBe(0.1)
    expect(fitZoom('fitAll', natural, { width: 1000, height: 400 })).toBe(0.4)
  })
  it('本来の寸法より大きくはしない', () => {
    expect(fitZoom('fitWidth', { width: 100, height: 50 }, { width: 1000, height: 1000 })).toBe(1)
    expect(fitZoom('fitAll', { width: 100, height: 50 }, { width: 1000, height: 1000 })).toBe(1)
  })
  it('最小の拡大率より小さくはしない', () => {
    expect(fitZoom('fitWidth', { width: 100000, height: 50 }, { width: 100, height: 100 })).toBe(MIN_ZOOM)
  })
})

describe('stepZoom', () => {
  it('段階に沿って拡大・縮小する', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
  })
  it('段階の間の値からは、近い次の段階へ移る', () => {
    expect(stepZoom(0.42, 1)).toBe(0.5)
    expect(stepZoom(0.42, -1)).toBe(0.33)
  })
  it('端では止まる', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('wheelZoom', () => {
  it('上に回すと拡大、下に回すと縮小', () => {
    expect(wheelZoom(1, -100, 0)).toBeGreaterThan(1)
    expect(wheelZoom(1, 100, 0)).toBeLessThan(1)
  })
  it('1回の変化量には上限がある（行単位も画素に直す）', () => {
    expect(wheelZoom(1, 1000, 0)).toBe(wheelZoom(1, 100, 0))
    expect(wheelZoom(1, 10, 1)).toBe(wheelZoom(1, 100, 0))
  })
  it('範囲に収める', () => {
    expect(wheelZoom(MAX_ZOOM, -100, 0)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
  })
})
