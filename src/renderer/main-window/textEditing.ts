/** エディタを補う純粋関数（JSON の文法チェック）。 */

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
