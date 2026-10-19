import { columnLabel, parseCsvRecords, toCsvTable } from '@renderer/main-window/csvTable'

function parseCsvTable(text: string, delimiter: ',' | '\t', firstRowIsHeader: boolean): ReturnType<typeof toCsvTable> {
  return toCsvTable(parseCsvRecords(text, delimiter), firstRowIsHeader)
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
    const table = parseCsvTable('名前,年齢\n佐藤,30\n鈴木,25\n', ',', true)
    expect(table.headers).toEqual(['名前', '年齢'])
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['佐藤', '30'] },
      { rowNumber: 3, cells: ['鈴木', '25'] }
    ])
  })

  it('見出しにしないときは列名を A, B… にし、1行目もデータにする', () => {
    const table = parseCsvTable('a,b\nc,d', ',', false)
    expect(table.headers).toEqual(['A', 'B'])
    expect(table.rows.map((r) => r.rowNumber)).toEqual([1, 2])
  })

  it('引用符の中の区切り文字・改行・引用符は値の一部にする', () => {
    const table = parseCsvTable('x,y\n"a,b","1行目\n2行目"\n"say ""hi""",z\n', ',', true)
    expect(table.rows.map((r) => r.cells)).toEqual([
      ['a,b', '1行目\n2行目'],
      ['say "hi"', 'z']
    ])
  })

  it('TSV はタブで区切る', () => {
    expect(parseCsvTable('a\tb,c\n', '\t', false).rows[0]?.cells).toEqual(['a', 'b,c'])
  })

  it('列の数が揃っていない行は空で埋め、見出しが空の列には列名を付ける', () => {
    const table = parseCsvTable('id,,note\n1\n2,x,y,extra\n', ',', true)
    expect(table.headers).toEqual(['id', 'B', 'note', 'D'])
    expect(table.rows.map((r) => r.cells)).toEqual([
      ['1', '', '', ''],
      ['2', 'x', 'y', 'extra']
    ])
  })

  it('途中の空行は残し、末尾の改行による空の行だけ除く', () => {
    expect(parseCsvTable('a\n\nb\n', ',', false).rows.map((r) => r.cells)).toEqual([['a'], [''], ['b']])
  })

  it('空のファイルは列も行も無い', () => {
    expect(parseCsvTable('', ',', true)).toEqual({ headers: [], rows: [] })
  })
})
