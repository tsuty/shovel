/**
 * 行単位の差分計算。decisions.md N-3-8「IDE が無償提供していた Diff ビューアを
 * 自作する」の計算部分。表示は `DiffView` が受け持つ。
 *
 * ツールコールの `diffs`（変更前後の全文）を `DiffRow` の列へ畳んでから渡す
 * （`diffRowsFromTexts`）。
 */

export interface DiffRow {
  kind: 'context' | 'add' | 'remove' | 'gap'
  /** 変更前のファイルでの行番号（`add` には無い）。 */
  oldNo?: number
  /** 変更後のファイルでの行番号（`remove` には無い）。 */
  newNo?: number
  text: string
  /** `kind: 'gap'` で、折り畳んだ行数を示すとき。 */
  count?: number
}

/** 前後3行だけ残して、変更から遠い文脈は畳む。 */
const CONTEXT_LINES = 3

/**
 * 総当たりの LCS は行数の積だけメモリを食う。巨大ファイル同士の比較で UI を
 * 固まらせないため、共通の前後を削ったうえでこの大きさを超えたら
 * 「まるごと置き換え」として描く。
 */
const LCS_CELL_LIMIT = 4_000_000

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  // 末尾の改行は「最後の行の終わり」であって空行ではない。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 変更前後の全文から行の差分を組み立てる。 */
export function diffRowsFromTexts(oldText: string, newText: string): DiffRow[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)

  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }
  let endOld = oldLines.length
  let endNew = newLines.length
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--
    endNew--
  }

  const rows: DiffRow[] = []
  for (let i = 0; i < start; i++) {
    rows.push({ kind: 'context', oldNo: i + 1, newNo: i + 1, text: oldLines[i]! })
  }

  const midOld = oldLines.slice(start, endOld)
  const midNew = newLines.slice(start, endNew)
  for (const row of diffMiddle(midOld, midNew, start)) rows.push(row)

  for (let i = endOld; i < oldLines.length; i++) {
    rows.push({ kind: 'context', oldNo: i + 1, newNo: i + (endNew - endOld) + 1, text: oldLines[i]! })
  }
  return rows
}

function diffMiddle(oldLines: string[], newLines: string[], offset: number): DiffRow[] {
  if (oldLines.length === 0 && newLines.length === 0) return []
  const rows: DiffRow[] = []

  if (oldLines.length * newLines.length > LCS_CELL_LIMIT) {
    oldLines.forEach((text, i) => rows.push({ kind: 'remove', oldNo: offset + i + 1, text }))
    newLines.forEach((text, i) => rows.push({ kind: 'add', newNo: offset + i + 1, text }))
    return rows
  }

  // 末尾から詰める LCS。lcs[i][j] = oldLines[i..] と newLines[j..] の最長共通部分列長。
  const width = newLines.length + 1
  const lcs = new Uint32Array((oldLines.length + 1) * width)
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[i] === newLines[j]
          ? lcs[(i + 1) * width + (j + 1)]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + (j + 1)]!)
    }
  }

  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ kind: 'context', oldNo: offset + i + 1, newNo: offset + j + 1, text: oldLines[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + (j + 1)]!) {
      rows.push({ kind: 'remove', oldNo: offset + i + 1, text: oldLines[i]! })
      i++
    } else {
      rows.push({ kind: 'add', newNo: offset + j + 1, text: newLines[j]! })
      j++
    }
  }
  while (i < oldLines.length) {
    rows.push({ kind: 'remove', oldNo: offset + i + 1, text: oldLines[i]! })
    i++
  }
  while (j < newLines.length) {
    rows.push({ kind: 'add', newNo: offset + j + 1, text: newLines[j]! })
    j++
  }
  return rows
}

/** 変更から遠い文脈行を1つの `gap` にまとめる。 */
export function collapseContext(rows: DiffRow[]): DiffRow[] {
  const keep = rows.map((row) => row.kind !== 'context')
  rows.forEach((row, index) => {
    if (row.kind !== 'add' && row.kind !== 'remove') return
    for (let i = Math.max(0, index - CONTEXT_LINES); i <= Math.min(rows.length - 1, index + CONTEXT_LINES); i++) {
      keep[i] = true
    }
  })

  const out: DiffRow[] = []
  let hidden = 0
  const flush = (): void => {
    if (hidden === 0) return
    out.push({ kind: 'gap', text: '', count: hidden })
    hidden = 0
  }
  rows.forEach((row, index) => {
    if (keep[index]) {
      flush()
      out.push(row)
    } else {
      hidden++
    }
  })
  flush()
  return out
}
