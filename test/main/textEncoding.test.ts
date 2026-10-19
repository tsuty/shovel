import { decodeText, detectLineEnding, encodeForWrite, UnencodableTextError } from '@main/domain/textEncoding'

const bom = Buffer.from([0xef, 0xbb, 0xbf])

describe('detectLineEnding', () => {
  it.each([
    ['a\nb\n', 'LF'],
    ['a\r\nb\r\n', 'CRLF'],
    ['a\rb\r', 'CR'],
    ['a\r\nb\n', 'mixed'],
    ['abc', 'none'],
    ['', 'none']
  ] as const)('%j は %s', (text, expected) => {
    expect(detectLineEnding(text)).toBe(expected)
  })
})

describe('decodeText', () => {
  it('UTF-8 を読み、改行を LF に揃える', () => {
    expect(decodeText(Buffer.from('あ\r\nい\r\n', 'utf8'))).toEqual({
      kind: 'text',
      content: 'あ\nい\n',
      encoding: 'UTF-8',
      lineEnding: 'CRLF'
    })
  })

  it('BOM 付き UTF-8 は BOM を本文に含めない', () => {
    const result = decodeText(Buffer.concat([bom, Buffer.from('abc', 'utf8')]))
    expect(result).toEqual({ kind: 'text', content: 'abc', encoding: 'UTF-8 BOM', lineEnding: 'none' })
  })

  it('UTF-16 LE を BOM で判定する', () => {
    const body = Buffer.from('hi\n', 'utf16le')
    const result = decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), body]))
    expect(result).toEqual({ kind: 'text', content: 'hi\n', encoding: 'UTF-16 LE', lineEnding: 'LF' })
  })

  it('Shift_JIS を判定する', () => {
    const sjis = Buffer.from([0x82, 0xa0, 0x82, 0xa2]) // 「あい」
    expect(decodeText(sjis)).toEqual({ kind: 'text', content: 'あい', encoding: 'Shift_JIS', lineEnding: 'none' })
  })

  it('NULL バイトを含むものはバイナリ', () => {
    expect(decodeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toEqual({ kind: 'binary' })
  })

  it('空ファイルは改行なしの UTF-8', () => {
    expect(decodeText(Buffer.alloc(0))).toEqual({ kind: 'text', content: '', encoding: 'UTF-8', lineEnding: 'none' })
  })
})

describe('encodeForWrite', () => {
  it('新規ファイルは LF の UTF-8 で書く', () => {
    expect(encodeForWrite('a\nb', null).toString('utf8')).toBe('a\nb')
  })

  it('既存の CRLF を保つ', () => {
    const existing = Buffer.from('x\r\ny\r\n', 'utf8')
    expect(encodeForWrite('x\ny\nz\n', existing).toString('utf8')).toBe('x\r\ny\r\nz\r\n')
  })

  it('既存の CR を保つ', () => {
    const existing = Buffer.from('x\ry\r', 'utf8')
    expect(encodeForWrite('x\ny\nz\n', existing).toString('utf8')).toBe('x\ry\rz\r')
  })

  it('既存の BOM を保つ', () => {
    const existing = Buffer.concat([bom, Buffer.from('a\n', 'utf8')])
    const written = encodeForWrite('b\n', existing)
    expect(written.subarray(0, 3)).toEqual(bom)
    expect(written.subarray(3).toString('utf8')).toBe('b\n')
  })

  it('混在しているファイルは多い方の改行に揃える', () => {
    const existing = Buffer.from('a\r\nb\r\nc\n', 'utf8')
    expect(encodeForWrite('a\nb\n', existing).toString('utf8')).toBe('a\r\nb\r\n')
  })

  it('改行の無い既存ファイルは LF で書く', () => {
    expect(encodeForWrite('a\nb', Buffer.from('a', 'utf8')).toString('utf8')).toBe('a\nb')
  })

  it('UTF-8・Shift_JIS 以外の既存ファイルへの上書きは拒否する', () => {
    expect(() => encodeForWrite('a', Buffer.from([0x00, 0x01]))).toThrow(/not UTF-8 or Shift_JIS/)
    expect(() => encodeForWrite('a', Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toThrow(/not UTF-8 or Shift_JIS/)
  })

  it('Shift_JIS の既存ファイルは Shift_JIS と元の改行コードで書く', () => {
    const existing = Buffer.from([0x82, 0xa0, 0x0d, 0x0a]) // 「あ」CRLF
    const written = encodeForWrite('あい\nう\n', existing)
    expect(written).toEqual(Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x0d, 0x0a, 0x82, 0xa4, 0x0d, 0x0a]))
    expect(decodeText(written)).toMatchObject({ encoding: 'Shift_JIS', content: 'あい\nう\n', lineEnding: 'CRLF' })
  })

  it('Shift_JIS では Windows の機種依存文字も書ける', () => {
    const existing = Buffer.from([0x82, 0xa0])
    const text = '①髙﨑～'
    const written = encodeForWrite(text, existing)
    expect(decodeText(written)).toMatchObject({ encoding: 'Shift_JIS', content: text })
  })

  it('Shift_JIS で表せない文字があれば、最初の位置を付けて拒否する', () => {
    const existing = Buffer.from([0x82, 0xa0])
    let caught: unknown
    try {
      encodeForWrite('あ\nい😀う🍣', existing)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(UnencodableTextError)
    expect(caught).toMatchObject({ line: 2, column: 2, char: '😀' })
  })

  it('読んで LF に揃えた内容を書き戻すと元のバイト列に戻る', () => {
    const samples = [
      Buffer.from('a\r\nb\r\n', 'utf8'),
      Buffer.concat([bom, Buffer.from('a\nb', 'utf8')]),
      Buffer.from('日本語\n', 'utf8'),
      Buffer.from([0x82, 0xa0, 0x2c, 0x82, 0xa2, 0x0d, 0x0a, 0x87, 0x40, 0x0d, 0x0a]) // 「あ,い」CRLF「①」CRLF（Shift_JIS）
    ]
    for (const original of samples) {
      const decoded = decodeText(original)
      if (decoded.kind !== 'text') throw new Error('expected text')
      expect(encodeForWrite(decoded.content, original)).toEqual(original)
    }
  })
})
