/** エディタの textarea を補う純粋関数（Tab でのインデントと JSON の文法チェック）。 */

export const INDENT = '  '

export interface IndentEdit {
  /** 置き換える範囲（元の文字列での位置）と、そこに入れる文字列。 */
  replaceStart: number
  replaceEnd: number
  insert: string
  /** 置き換えた後の選択範囲。 */
  selectionStart: number
  selectionEnd: number
}

/**
 * Tab / Shift+Tab の編集内容を求める。
 * - 選択が1行に収まっていて Tab: カーソル位置（選択していれば選択範囲）をスペース2つに置き換える。
 * - 複数行にまたがる選択か Shift+Tab: 選択にかかる各行の先頭にスペース2つを足す / 先頭の空白を最大2つ取る。
 * 何も変わらないとき（行頭に空白が無い行への Shift+Tab）は null。
 */
export function computeIndent(value: string, start: number, end: number, outdent: boolean): IndentEdit | null {
  const multiLine = value.slice(start, end).includes('\n')
  if (!outdent && !multiLine) {
    const caret = start + INDENT.length
    return { replaceStart: start, replaceEnd: end, insert: INDENT, selectionStart: caret, selectionEnd: caret }
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  // 選択の終わりがちょうど行頭なら、その行は含めない（行を丸ごと選んだときの見た目に合わせる）。
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nextNewline = value.indexOf('\n', effectiveEnd)
  const lineEnd = nextNewline === -1 ? value.length : nextNewline
  const lines = value.slice(lineStart, lineEnd).split('\n')

  let firstDelta = 0
  let totalDelta = 0
  const changed = lines.map((line, i) => {
    let delta: number
    let next: string
    if (outdent) {
      const removable = line.match(/^ {1,2}|^\t/)?.[0].length ?? 0
      next = line.slice(removable)
      delta = -removable
    } else {
      next = INDENT + line
      delta = INDENT.length
    }
    if (i === 0) firstDelta = delta
    totalDelta += delta
    return next
  })
  if (totalDelta === 0) return null

  const insert = changed.join('\n')
  // 行頭から選んでいたら行頭のまま（行を丸ごと選んだ状態を保つ）。空白を取っても行頭は越えない。
  const selectionStart = start === lineStart ? lineStart : Math.max(lineStart, start + firstDelta)
  const selectionEnd = Math.max(selectionStart, end + totalDelta)
  return { replaceStart: lineStart, replaceEnd: lineEnd, insert, selectionStart, selectionEnd }
}

export interface JsonProblem {
  /** 1 始まり。位置が分からないときは undefined。 */
  line?: number
  column?: number
  /** `JSON.parse` の元のメッセージ。 */
  message: string
}

/** JSON として読めなければ、その位置（分かれば）と元のメッセージを返す。 */
export function findJsonProblem(text: string): JsonProblem | null {
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const lineCol = message.match(/line (\d+) column (\d+)/)
    if (lineCol) return { line: Number(lineCol[1]), column: Number(lineCol[2]), message }
    const position = message.match(/position (\d+)/)
    if (position) {
      const offset = Number(position[1])
      const before = text.slice(0, offset)
      const line = before.split('\n').length
      const column = offset - (before.lastIndexOf('\n') + 1) + 1
      return { line, column, message }
    }
    // 「Unexpected end of JSON input」など: 末尾で途切れている。
    if (/end of JSON input/i.test(message)) {
      const lines = text.split('\n')
      return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1, message }
    }
    return { message }
  }
}

/** 1 始まりの行・列を文字列中の位置にする（範囲外は末尾・行末に丸める）。 */
export function offsetAt(text: string, line: number, column: number): number {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf('\n', offset)
    if (newline === -1) return text.length
    offset = newline + 1
  }
  const lineEnd = text.indexOf('\n', offset)
  const lineLength = (lineEnd === -1 ? text.length : lineEnd) - offset
  return offset + Math.min(Math.max(column - 1, 0), lineLength)
}

/** 行番号の列に出す文字列（`1\n2\n…`）。 */
export function lineNumbersText(text: string): string {
  let count = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count++
  return Array.from({ length: count }, (_, i) => String(i + 1)).join('\n')
}
