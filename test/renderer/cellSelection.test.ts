import {
  copyPlan,
  dragTo,
  moveBy,
  planToTsv,
  pressAt,
  rangeBounds,
  selectAll,
  type CellSelection
} from '@renderer/main-window/cellSelection'
import { parseCsvRecords, toCsvTable } from '@renderer/main-window/csvTable'

const size = { rows: 5, cols: 4 }
const none = { shift: false, add: false }
const cells = (r1: number, c1: number, r2 = r1, c2 = c1): CellSelection => [
  { kind: 'cells', anchor: { row: r1, col: c1 }, focus: { row: r2, col: c2 } }
]

describe('rangeBounds', () => {
  it('行全体は左右の端まで、列全体は上下の端まで', () => {
    expect(rangeBounds({ kind: 'rows', anchor: { row: 3, col: 0 }, focus: { row: 1, col: 0 } }, size)).toEqual({
      top: 1,
      bottom: 3,
      left: 0,
      right: 3
    })
    expect(rangeBounds({ kind: 'columns', anchor: { row: 0, col: 2 }, focus: { row: 0, col: 2 } }, size)).toEqual({
      top: 0,
      bottom: 4,
      left: 2,
      right: 2
    })
  })
})

describe('pressAt / dragTo', () => {
  it('修飾キーなしは押したセルだけを選び直す', () => {
    expect(pressAt(cells(0, 0, 2, 2), 'cells', { row: 4, col: 1 }, none)).toEqual(cells(4, 1))
  })

  it('Shift は今の範囲の起点を残して先を伸ばす', () => {
    expect(pressAt(cells(1, 1), 'cells', { row: 3, col: 2 }, { shift: true, add: false })).toEqual(cells(1, 1, 3, 2))
  })

  it('Cmd/Ctrl は範囲を足す', () => {
    expect(pressAt(cells(0, 0), 'cells', { row: 2, col: 2 }, { shift: false, add: true })).toEqual([
      ...cells(0, 0),
      ...cells(2, 2)
    ])
  })

  it('セルを選んでから Shift で行番号を押すと、その間の行全体になる', () => {
    expect(pressAt(cells(1, 2), 'rows', { row: 3, col: 0 }, { shift: true, add: false })).toEqual([
      { kind: 'rows', anchor: { row: 1, col: 2 }, focus: { row: 3, col: 0 } }
    ])
  })

  it('ドラッグは今の範囲の先だけを動かす', () => {
    const selection = [...cells(0, 0), ...cells(2, 2)]
    expect(dragTo(selection, { row: 4, col: 3 })).toEqual([...cells(0, 0), ...cells(2, 2, 4, 3)])
  })
})

describe('moveBy', () => {
  it('矢印は今のセルを動かしてそれだけを選ぶ', () => {
    expect(moveBy(cells(1, 1, 3, 3), 'ArrowDown', { extend: false, toEdge: false }, size)).toEqual(cells(2, 1))
  })

  it('Shift+矢印は範囲の先を動かす', () => {
    expect(moveBy(cells(1, 1, 2, 2), 'ArrowRight', { extend: true, toEdge: false }, size)).toEqual(cells(1, 1, 2, 3))
  })

  it('Cmd/Ctrl+矢印は端まで動かし、表の外には出ない', () => {
    expect(moveBy(cells(1, 1), 'ArrowDown', { extend: false, toEdge: true }, size)).toEqual(cells(4, 1))
    expect(moveBy(cells(0, 0), 'ArrowUp', { extend: false, toEdge: false }, size)).toEqual(cells(0, 0))
  })
})

describe('copyPlan', () => {
  it('範囲が1つならその矩形で、見出しは付けない', () => {
    expect(copyPlan(cells(3, 2, 1, 1), size)).toEqual({ rows: [1, 2, 3], columns: [1, 2], withHeader: false })
  })

  it('行の位置が揃った範囲は列を左から並べる', () => {
    expect(copyPlan([...cells(1, 3, 2, 3), ...cells(1, 0, 2, 1)], size)).toEqual({
      rows: [1, 2],
      columns: [0, 1, 3],
      withHeader: false
    })
  })

  it('列の位置が揃った範囲は行を上から並べる', () => {
    expect(copyPlan([...cells(4, 0, 4, 1), ...cells(0, 0, 1, 1)], size)).toEqual({
      rows: [0, 1, 4],
      columns: [0, 1],
      withHeader: false
    })
  })

  it('行も列も揃わない範囲はコピーできない', () => {
    expect(copyPlan([...cells(0, 0), ...cells(2, 2)], size)).toBeNull()
  })

  it('列全体だけなら見出しを付ける。すべての選択も同じ', () => {
    const columns: CellSelection = [
      { kind: 'columns', anchor: { row: 0, col: 3 }, focus: { row: 0, col: 3 } },
      { kind: 'columns', anchor: { row: 0, col: 1 }, focus: { row: 0, col: 1 } }
    ]
    expect(copyPlan(columns, size)).toEqual({ rows: [0, 1, 2, 3, 4], columns: [1, 3], withHeader: true })
    expect(copyPlan(selectAll(size), size)?.withHeader).toBe(true)
  })
})

describe('planToTsv', () => {
  const table = toCsvTable(parseCsvRecords('名前,年齢,市\n佐藤,30,東京\n鈴木,25,大阪\n高橋,41,福岡\n', ','), true)

  it('表示の順で行を取り出す', () => {
    expect(planToTsv(table, [2, 1, 0], { rows: [0, 1], columns: [0, 2], withHeader: false })).toBe(
      '高橋\t福岡\n鈴木\t大阪'
    )
  })

  it('見出しを付けるときは見出しの行の値を先頭に置く', () => {
    expect(planToTsv(table, [0, 1, 2], { rows: [0, 1, 2], columns: [2], withHeader: true })).toBe(
      '市\n東京\n大阪\n福岡'
    )
  })

  it('1行目を見出しにしないときは、列名（A, B…）を付けない', () => {
    const plain = toCsvTable(parseCsvRecords('x,y\n1,2\n', ','), false)
    expect(planToTsv(plain, [0, 1], { rows: [0, 1], columns: [1], withHeader: true })).toBe('y\n2')
  })
})
