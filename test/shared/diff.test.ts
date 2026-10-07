import {
  collapseContext,
  diffRowsFromTexts,
  inlineSpans,
  toSplitRows,
  withInlineChanges,
  type DiffRow,
  type DiffSpan
} from '@shared/diff'

const kinds = (rows: DiffRow[]): string => rows.map((r) => r.kind[0]).join('')

describe('diffRowsFromTexts', () => {
  it('同じ内容なら全行が context', () => {
    const rows = diffRowsFromTexts('a\nb\n', 'a\nb\n')
    expect(rows).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'context', oldNo: 2, newNo: 2, text: 'b' }
    ])
  })

  it('1行の置き換えは remove + add になる', () => {
    const rows = diffRowsFromTexts('a\nb\nc', 'a\nB\nc')
    expect(rows).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'remove', oldNo: 2, text: 'b' },
      { kind: 'add', newNo: 2, text: 'B' },
      { kind: 'context', oldNo: 3, newNo: 3, text: 'c' }
    ])
  })

  it('挿入後の行番号は新旧でずれる', () => {
    const rows = diffRowsFromTexts('a\nc', 'a\nb\nc')
    expect(rows).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'add', newNo: 2, text: 'b' },
      { kind: 'context', oldNo: 2, newNo: 3, text: 'c' }
    ])
  })

  it('新規ファイル（変更前が空）は全行 add', () => {
    expect(kinds(diffRowsFromTexts('', 'x\ny\n'))).toBe('aa')
  })

  it('全削除は全行 remove', () => {
    expect(kinds(diffRowsFromTexts('x\ny', ''))).toBe('rr')
  })

  it('CRLF と LF の違いは差分にしない', () => {
    expect(kinds(diffRowsFromTexts('a\r\nb\r\n', 'a\nb\n'))).toBe('cc')
  })

  it('末尾の改行の有無は差分にしない', () => {
    expect(kinds(diffRowsFromTexts('a\nb', 'a\nb\n'))).toBe('cc')
  })

  it('中間の変更は LCS で最小限の行だけを変更として出す', () => {
    const rows = diffRowsFromTexts('1\n2\n3\n4\n5', '1\nX\n3\nY\n5')
    expect(kinds(rows)).toBe('cracrac')
  })

  it('巨大な差分はまるごと置き換えとして扱う', () => {
    const oldText = Array.from({ length: 2100 }, (_, i) => `old${i}`).join('\n')
    const newText = Array.from({ length: 2100 }, (_, i) => `new${i}`).join('\n')
    const rows = diffRowsFromTexts(oldText, newText)
    expect(rows).toHaveLength(4200)
    expect(rows.slice(0, 2100).every((r) => r.kind === 'remove')).toBe(true)
    expect(rows.slice(2100).every((r) => r.kind === 'add')).toBe(true)
  })

  it('どんな入力でも、context+remove が変更前の行、context+add が変更後の行を再現する', () => {
    const samples: [string, string][] = [
      ['a\nb\nc\nd', 'b\nc\ne'],
      ['x\nx\nx', 'x\ny\nx\nx'],
      ['', 'a'],
      ['a\nb', 'b\na'],
      ['1\n2\n3\n4\n5\n6', '6\n5\n4\n3\n2\n1']
    ]
    for (const [oldText, newText] of samples) {
      const rows = diffRowsFromTexts(oldText, newText)
      const oldBack = rows.filter((r) => r.kind !== 'add').map((r) => r.text)
      const newBack = rows.filter((r) => r.kind !== 'remove').map((r) => r.text)
      expect(oldBack).toEqual(oldText === '' ? [] : oldText.split('\n'))
      expect(newBack).toEqual(newText === '' ? [] : newText.split('\n'))
      expect(rows.filter((r) => r.oldNo !== undefined).map((r) => r.oldNo)).toEqual(oldBack.map((_, i) => i + 1))
      expect(rows.filter((r) => r.newNo !== undefined).map((r) => r.newNo)).toEqual(newBack.map((_, i) => i + 1))
    }
  })
})

describe('collapseContext', () => {
  it('変更の前後3行を残し、それより遠い文脈を gap に畳む', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n')
    const newText = oldText.replace('l10', 'L10')
    const rows = collapseContext(diffRowsFromTexts(oldText, newText))
    expect(rows[0]).toEqual({ kind: 'gap', text: '', count: 6 })
    expect(rows.slice(1, 4).map((r) => r.text)).toEqual(['l7', 'l8', 'l9'])
    expect(rows.slice(4, 6).map((r) => r.kind)).toEqual(['remove', 'add'])
    expect(rows.slice(6, 9).map((r) => r.text)).toEqual(['l11', 'l12', 'l13'])
    expect(rows[9]).toEqual({ kind: 'gap', text: '', count: 7 })
    expect(rows).toHaveLength(10)
  })

  it('変更が無ければ全体が1つの gap になる', () => {
    expect(collapseContext(diffRowsFromTexts('a\nb', 'a\nb'))).toEqual([{ kind: 'gap', text: '', count: 2 }])
  })

  it('近い変更同士の間の文脈は畳まない', () => {
    const rows = collapseContext(diffRowsFromTexts('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE'))
    expect(rows.some((r) => r.kind === 'gap')).toBe(false)
  })
})

/** 変更部分を [] で囲んだ文字列にする。 */
const marked = (spans: DiffSpan[]): string => spans.map((s) => (s.changed ? `[${s.text}]` : s.text)).join('')

describe('inlineSpans', () => {
  it('英語は単語単位で変更部分を示す', () => {
    const spans = inlineSpans('I like cats very much', 'I like dogs very much')
    expect(spans && marked(spans.old)).toBe('I like [cats] very much')
    expect(spans && marked(spans.new)).toBe('I like [dogs] very much')
  })

  it('日本語も単語単位で変更部分を示す', () => {
    const spans = inlineSpans('今日は良い天気です。', '明日は良い天気です。')
    expect(spans && marked(spans.old)).toBe('[今日]は良い天気です。')
    expect(spans && marked(spans.new)).toBe('[明日]は良い天気です。')
  })

  it('変更に挟まれた空白は変更側に寄せる', () => {
    const spans = inlineSpans('a b c d e f g', 'a b X Y e f g')
    expect(spans && marked(spans.new)).toBe('a b [X Y] e f g')
  })

  it('似ていない行には付けない', () => {
    expect(inlineSpans('completely different', 'nothing in common here')).toBeNull()
    expect(inlineSpans('', 'added')).toBeNull()
  })

  it('つなぎ直すと元の行に戻る', () => {
    const spans = inlineSpans('const x = foo(1, 2)', 'const y = foo(1, 3)')
    expect(spans?.old.map((s) => s.text).join('')).toBe('const x = foo(1, 2)')
    expect(spans?.new.map((s) => s.text).join('')).toBe('const y = foo(1, 3)')
  })
})

describe('withInlineChanges', () => {
  it('変更のかたまりの中で i 番目の削除行と i 番目の追加行を対にする', () => {
    const rows = withInlineChanges(diffRowsFromTexts('keep\nalpha one\nbeta two\n', 'keep\nalpha ONE\nbeta TWO\nextra\n'))
    const changed = rows.filter((r) => r.kind !== 'context')
    expect(changed.map((r) => [r.kind, r.spans ? marked(r.spans) : null])).toEqual([
      ['remove', 'alpha [one]'],
      ['remove', 'beta [two]'],
      ['add', 'alpha [ONE]'],
      ['add', 'beta [TWO]'],
      ['add', null]
    ])
  })

  it('元の行は書き換えない', () => {
    const rows = diffRowsFromTexts('a b c', 'a b d')
    withInlineChanges(rows)
    expect(rows.every((r) => r.spans === undefined)).toBe(true)
  })
})

describe('toSplitRows', () => {
  it('文脈行は左右に同じ行、変更のかたまりは上から1対1で並べ、相手の無い側は null', () => {
    const split = toSplitRows(diffRowsFromTexts('a\nb\nc\nz', 'a\nB\nC\nD\nz'))
    expect(
      split.map((r) => (r.kind === 'gap' ? 'gap' : `${r.left?.text ?? '-'}|${r.right?.text ?? '-'}`))
    ).toEqual(['a|a', 'b|B', 'c|C', '-|D', 'z|z'])
  })

  it('削除の方が多ければ右側が空く', () => {
    const split = toSplitRows(diffRowsFromTexts('a\nb\nc', 'X'))
    expect(split.map((r) => (r.kind === 'pair' ? r.right?.text ?? null : 'gap'))).toEqual(['X', null, null])
  })

  it('gap はそのまま1行にする', () => {
    const rows = collapseContext(diffRowsFromTexts('1\n2\n3\n4\n5\n6\n7\n8', '1\n2\n3\n4\n5\n6\n7\nX'))
    const split = toSplitRows(rows)
    expect(split[0]).toEqual({ kind: 'gap', row: { kind: 'gap', text: '', count: 4 } })
  })
})
