import { computeIndent, findJsonProblem, lineNumbersText, offsetAt } from '@renderer/main-window/textEditing'

/** 編集を当てた結果の文字列と、選択範囲を `[` `]` で示した文字列を返す。 */
function apply(value: string, start: number, end: number, outdent = false): string | null {
  const edit = computeIndent(value, start, end, outdent)
  if (!edit) return null
  const next = value.slice(0, edit.replaceStart) + edit.insert + value.slice(edit.replaceEnd)
  return next.slice(0, edit.selectionStart) + '[' + next.slice(edit.selectionStart, edit.selectionEnd) + ']' + next.slice(edit.selectionEnd)
}

describe('computeIndent', () => {
  it('inserts two spaces at the caret', () => {
    expect(apply('{\n"a": 1\n}', 2, 2)).toBe('{\n  []"a": 1\n}')
  })

  it('replaces a single-line selection with two spaces', () => {
    expect(apply('abc', 1, 2)).toBe('a  []c')
  })

  it('indents every line touched by a multi-line selection', () => {
    expect(apply('a\nb\nc', 0, 3)).toBe('[  a\n  b]\nc')
  })

  it('does not indent the line after a selection that ends at its start', () => {
    expect(apply('a\nb\nc', 0, 2)).toBe('[  a\n]b\nc')
  })

  it('outdents up to two spaces per line', () => {
    expect(apply('    a\n b\nc', 4, 8, true)).toBe('  [a\nb]\nc')
  })

  it('outdents the caret line without moving past the line start', () => {
    expect(apply('x\n  ab', 3, 3, true)).toBe('x\n[]ab')
  })

  it('returns null when there is nothing to outdent', () => {
    expect(apply('a\nb', 0, 3, true)).toBeNull()
  })
})

describe('findJsonProblem', () => {
  it('returns null for valid JSON', () => {
    expect(findJsonProblem('{\n  "mcpServers": {}\n}\n')).toBeNull()
  })

  it('reports line and column of a trailing comma', () => {
    expect(findJsonProblem('{\n  "a": 1,\n}')).toMatchObject({ line: 3, column: 1 })
  })

  it('reports the end of the text when the input is cut off', () => {
    expect(findJsonProblem('{\n  "a": 1')).toMatchObject({ line: 2 })
  })

  it('treats an empty file as a problem', () => {
    expect(findJsonProblem('')).not.toBeNull()
  })
})

describe('offsetAt', () => {
  it('maps a 1-based line/column to an offset', () => {
    expect(offsetAt('ab\ncd\nef', 2, 2)).toBe(4)
  })

  it('clamps past the end of a line or the text', () => {
    expect(offsetAt('ab\ncd', 1, 99)).toBe(2)
    expect(offsetAt('ab\ncd', 9, 1)).toBe(5)
  })
})

describe('lineNumbersText', () => {
  it('numbers every line, including a trailing empty one', () => {
    expect(lineNumbersText('')).toBe('1')
    expect(lineNumbersText('a\nb\n')).toBe('1\n2\n3')
  })
})
