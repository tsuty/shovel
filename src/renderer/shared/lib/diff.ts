/**
 * 行単位の差分計算と unified diff の解析。decisions.md N-3「IDE が無償提供して
 * いた Diff ビューアを自作する」の計算部分。表示は `DiffView` が受け持つ。
 *
 * 差分の入力が2種類あるため（decisions.md N-3-7）、どちらも同じ行の列へ
 * 畳んでから描く:
 *   - ツールコールの `diffs`  … 変更前後の全文（`diffRowsFromTexts`）
 *   - 「変更」サイドバー      … `git diff` の unified 形式（`diffRowsFromUnified`）
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

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** `git diff` の unified 形式を行の列へ解す。ファイルヘッダ（`diff --git` 等）は捨てる。 */
export function diffRowsFromUnified(unified: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false

  const lines = unified.replace(/\r\n/g, '\n').split('\n')
  // 末尾の改行が生む空要素は行ではない。落とさないと最後に空の文脈行が1つ増える。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[3])
      inHunk = true
      rows.push({ kind: 'gap', text: line })
      continue
    }
    if (!inHunk) continue
    // 「\ No newline at end of file」は行そのものではないので落とす。
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', newNo: newNo++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'remove', oldNo: oldNo++, text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) })
    } else if (line === '') {
      // hunk の途中の空行は「空の文脈行」。末尾の余りは無視する。
      if (rows.length > 0) rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: '' })
    }
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

export function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added++
    else if (row.kind === 'remove') removed++
  }
  return { added, removed }
}
