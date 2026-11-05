import {
  columnLabel,
  estimateCellLines,
  estimateRowLines,
  loadHeaderRowCount,
  loadWrapCells,
  parseCsvRecords,
  saveHeaderRowCount,
  saveWrapCells,
  toCsvTable,
  toTsv
} from '@renderer/main-window/csvTable'

function parseCsvTable(text: string, delimiter: ',' | '\t', headerRowCount: number): ReturnType<typeof toCsvTable> {
  return toCsvTable(parseCsvRecords(text, delimiter), headerRowCount)
}

describe('columnLabel', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [701, 'ZZ'],
    [702, 'AAA']
  ])('%i は %s', (index, expected) => {
    expect(columnLabel(index)).toBe(expected)
  })
})

describe('parseCsvRecords + toCsvTable', () => {
  it('1行目を見出しにし、行番号は見出しの行も数える', () => {
    const table = parseCsvTable('名前,年齢\n佐藤,30\n鈴木,25\n', ',', 1)
    expect(table.headers).toEqual(['名前', '年齢'])
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['佐藤', '30'] },
      { rowNumber: 3, cells: ['鈴木', '25'] }
    ])
  })

  it('見出しにしないときは列名を A, B… にし、1行目もデータにする', () => {
    const table = parseCsvTable('a,b\nc,d', ',', 0)
    expect(table.headers).toEqual(['A', 'B'])
    expect(table.rows.map((r) => r.rowNumber)).toEqual([1, 2])
  })

  it('引用符の中の区切り文字・改行・引用符は値の一部にする', () => {
    const table = parseCsvTable('x,y\n"a,b","1行目\n2行目"\n"say ""hi""",z\n', ',', 1)
    expect(table.rows.map((r) => r.cells)).toEqual([
      ['a,b', '1行目\n2行目'],
      ['say "hi"', 'z']
    ])
  })

  it('TSV はタブで区切る', () => {
    expect(parseCsvTable('a\tb,c\n', '\t', 0).rows[0]?.cells).toEqual(['a', 'b,c'])
  })

  it('列の数が揃っていない行は空で埋め、見出しが空の列には列名を付ける', () => {
    const table = parseCsvTable('id,,note\n1\n2,x,y,extra\n', ',', 1)
    expect(table.headers).toEqual(['id', 'B', 'note', 'D'])
    expect(table.rows.map((r) => r.cells)).toEqual([
      ['1', '', '', ''],
      ['2', 'x', 'y', 'extra']
    ])
  })

  it('途中の空行は残し、末尾の改行による空の行だけ除く', () => {
    expect(parseCsvTable('a\n\nb\n', ',', 0).rows.map((r) => r.cells)).toEqual([['a'], [''], ['b']])
  })

  it('空のファイルは列も行も無い', () => {
    expect(parseCsvTable('', ',', 1)).toEqual({ headers: [], headerRows: [], rows: [] })
  })

  it('複数行を見出しにすると、列名は最後の見出しの行の値で、行番号は続きから数える', () => {
    const table = parseCsvTable('表題\n名前,年齢\n佐藤,30\n', ',', 2)
    expect(table.headers).toEqual(['名前', '年齢'])
    expect(table.headerRows).toEqual([
      { rowNumber: 1, cells: ['表題', ''] },
      { rowNumber: 2, cells: ['名前', '年齢'] }
    ])
    expect(table.rows).toEqual([{ rowNumber: 3, cells: ['佐藤', '30'] }])
  })

  it('上の見出しの行に値があっても、最後の見出しの行が空の列は列名にする', () => {
    expect(parseCsvTable('a,b\nc,\n', ',', 2).headers).toEqual(['c', 'B'])
  })

  it('見出しの行数がファイルの行数より多ければ、全部の行を見出しにする', () => {
    const table = parseCsvTable('a\nb\n', ',', 5)
    expect(table.headerRows.map((row) => row.rowNumber)).toEqual([1, 2])
    expect(table.headers).toEqual(['b'])
    expect(table.rows).toEqual([])
  })
})

describe('toTsv', () => {
  it('タブ・改行・引用符を含む値だけを引用符で囲む', () => {
    expect(toTsv([['a', 'b\tc'], ['d\ne', 'say "hi"']])).toBe('a\t"b\tc"\n"d\ne"\t"say ""hi"""')
  })
})

describe('estimateCellLines', () => {
  it('幅に収まる値は1行', () => {
    expect(estimateCellLines('abc', 10)).toBe(1)
    expect(estimateCellLines('', 1)).toBe(1)
  })

  it('改行の数だけ行が増える（CRLF も1つに数える）', () => {
    expect(estimateCellLines('a\nb\r\nc', 10)).toBe(3)
  })

  it('幅を超えた分は折り返し、全角は半角2文字に数える', () => {
    expect(estimateCellLines('abcdefghij', 4)).toBe(3)
    expect(estimateCellLines('あいうえ', 4)).toBe(2)
  })
})

describe('estimateRowLines', () => {
  it('その行でいちばん行数の多いセルに合わせる', () => {
    const rows = [
      { rowNumber: 1, cells: ['a', 'b\nc\nd'] },
      { rowNumber: 2, cells: ['abcdef', 'x'] }
    ]
    expect([...estimateRowLines(rows, [10, 2])]).toEqual([3, 1])
    expect([...estimateRowLines(rows, [2, 10])]).toEqual([3, 3])
  })
})

describe('表の設定の保存', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('見出しの行数は既定で 1。既定のときは書かない', () => {
    expect(loadHeaderRowCount('p', 'a.csv')).toBe(1)
    saveHeaderRowCount('p', 'a.csv', 3)
    expect(loadHeaderRowCount('p', 'a.csv')).toBe(3)
    expect(loadHeaderRowCount('p', 'b.csv')).toBe(1)
    saveHeaderRowCount('p', 'a.csv', 1)
    expect(store.size).toBe(0)
  })

  it('以前の「1行目を見出しにする」のオフは 0 として読み、保存すると古い設定を消す', () => {
    store.set('shovel.csvFirstRowIsHeader:p:a.csv', 'false')
    expect(loadHeaderRowCount('p', 'a.csv')).toBe(0)
    saveHeaderRowCount('p', 'a.csv', 2)
    expect(store.has('shovel.csvFirstRowIsHeader:p:a.csv')).toBe(false)
    expect(loadHeaderRowCount('p', 'a.csv')).toBe(2)
  })

  it('範囲外の値は読まない', () => {
    store.set('shovel.csvHeaderRowCount:p:a.csv', '99')
    expect(loadHeaderRowCount('p', 'a.csv')).toBe(1)
  })

  it('折り返しは既定でオフ', () => {
    expect(loadWrapCells('p', 'a.csv')).toBe(false)
    saveWrapCells('p', 'a.csv', true)
    expect(loadWrapCells('p', 'a.csv')).toBe(true)
    saveWrapCells('p', 'a.csv', false)
    expect(store.size).toBe(0)
  })
})
