/**
 * 行単位の差分計算。ツールコールの `diffs`（変更前後の全文）を `DiffRow` の列へ畳む（`diffRowsFromTexts`）。
 * 対になる削除行・追加行には単語単位の差分を付け（`withInlineChanges`）、左右2列の表示では
 * それらを横に並べる（`toSplitRows`）。
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
  /** `add` / `remove` で、対になる行との単語単位の差分。似ていない行には付けない。 */
  spans?: DiffSpan[]
}

/** 行の一部。`changed` は対になる行に無い部分。 */
export interface DiffSpan {
  text: string
  changed: boolean
}

/** 左右2列の1行。変更のかたまりの中で、相手の無い側は `null`。 */
export type SplitRow = { kind: 'gap'; row: DiffRow } | { kind: 'pair'; left: DiffRow | null; right: DiffRow | null }

/** 前後3行だけ残して、変更から遠い文脈は畳む。 */
const CONTEXT_LINES = 3

/** LCS の表の大きさの上限。共通の前後を削ったうえでこれを超えたら「まるごと置き換え」として扱う。 */
const LCS_CELL_LIMIT = 4_000_000

/** 行内（単語単位）の LCS の表の大きさの上限。超える行には行内の差分を付けない。 */
const INLINE_CELL_LIMIT = 250_000

/**
 * 行内の差分を付けるのに必要な、共通部分の割合（両側の文字数に対する共通部分の文字数）。
 * これ未満の「別物の行」は、ほぼ全体が変更として塗られて読みにくくなるので行の色だけにする。
 */
const INLINE_SIMILARITY = 0.5

type AlignOp = 'same' | 'remove' | 'add'

/** 2つの列の LCS をとり、先頭からの操作列にする。 */
function align<T>(a: readonly T[], b: readonly T[]): AlignOp[] {
  // 末尾から詰める LCS。lcs[i][j] = a[i..] と b[j..] の最長共通部分列長。
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + (j + 1)]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + (j + 1)]!)
    }
  }

  const ops: AlignOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push('same')
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + (j + 1)]!) {
      ops.push('remove')
      i++
    } else {
      ops.push('add')
      j++
    }
  }
  for (; i < a.length; i++) ops.push('remove')
  for (; j < b.length; j++) ops.push('add')
  return ops
}

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

  let i = 0
  let j = 0
  for (const op of align(oldLines, newLines)) {
    if (op === 'same') {
      rows.push({ kind: 'context', oldNo: offset + i + 1, newNo: offset + j + 1, text: oldLines[i]! })
      i++
      j++
    } else if (op === 'remove') {
      rows.push({ kind: 'remove', oldNo: offset + i + 1, text: oldLines[i]! })
      i++
    } else {
      rows.push({ kind: 'add', newNo: offset + j + 1, text: newLines[j]! })
      j++
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

/**
 * 連続する `remove` / `add` を1つの変更のかたまりにまとめる。かたまりの中では i 番目の削除行と
 * i 番目の追加行を対にする（左右の並びと、行内の差分の相手の両方に使う）。
 */
type Block = { kind: 'row'; row: DiffRow } | { kind: 'change'; removes: DiffRow[]; adds: DiffRow[] }

function toBlocks(rows: DiffRow[]): Block[] {
  const blocks: Block[] = []
  let current: Extract<Block, { kind: 'change' }> | null = null
  for (const row of rows) {
    if (row.kind === 'remove' || row.kind === 'add') {
      if (!current) {
        current = { kind: 'change', removes: [], adds: [] }
        blocks.push(current)
      }
      ;(row.kind === 'remove' ? current.removes : current.adds).push(row)
    } else {
      current = null
      blocks.push({ kind: 'row', row })
    }
  }
  return blocks
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

/** 単語（と空白・記号）に分ける。日本語のように空白で区切らない言語も、辞書で単語に分かれる。 */
function splitWords(text: string): string[] {
  return Array.from(wordSegmenter.segment(text), (s) => s.segment)
}

/** 連続する同じ種類の部分をつなぐ。 */
function toSpans(words: string[], changed: boolean[]): DiffSpan[] {
  const spans: DiffSpan[] = []
  words.forEach((text, index) => {
    // 変更に挟まれた空白は変更側に寄せる（「変更 空白 変更」が細切れに塗られないように）。
    const isChanged =
      changed[index]! || (/^\s+$/.test(text) && index > 0 && changed[index - 1]! && changed[index + 1] === true)
    const last = spans[spans.length - 1]
    if (last && last.changed === isChanged) last.text += text
    else spans.push({ text, changed: isChanged })
  })
  return spans
}

/** 対になる2行の単語単位の差分。似ていない行・長すぎる行は `null`（行の色だけで示す）。 */
export function inlineSpans(oldText: string, newText: string): { old: DiffSpan[]; new: DiffSpan[] } | null {
  const total = oldText.length + newText.length
  if (total === 0) return null
  const a = splitWords(oldText)
  const b = splitWords(newText)
  if (a.length * b.length > INLINE_CELL_LIMIT) return null

  const changedA: boolean[] = []
  const changedB: boolean[] = []
  let common = 0
  for (const op of align(a, b)) {
    if (op === 'same') {
      // 変更前の側の位置 = これまでに積んだ変更前の単語の数。
      common += a[changedA.length]!.length
      changedA.push(false)
      changedB.push(false)
    } else if (op === 'remove') {
      changedA.push(true)
    } else {
      changedB.push(true)
    }
  }
  if ((2 * common) / total < INLINE_SIMILARITY) return null
  return { old: toSpans(a, changedA), new: toSpans(b, changedB) }
}

/** 対になる削除行・追加行に、単語単位の差分（`spans`）を付ける。 */
export function withInlineChanges(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = []
  for (const block of toBlocks(rows)) {
    if (block.kind === 'row') {
      out.push(block.row)
      continue
    }
    const removes = block.removes.map((row) => ({ ...row }))
    const adds = block.adds.map((row) => ({ ...row }))
    for (let k = 0; k < Math.min(removes.length, adds.length); k++) {
      const spans = inlineSpans(removes[k]!.text, adds[k]!.text)
      if (!spans) continue
      removes[k]!.spans = spans.old
      adds[k]!.spans = spans.new
    }
    out.push(...removes, ...adds)
  }
  return out
}

/** 左右2列の行に並べ替える。文脈行は左右に同じ行を、変更のかたまりは削除行と追加行を上から1対1で並べる。 */
export function toSplitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  for (const block of toBlocks(rows)) {
    if (block.kind === 'row') {
      out.push(block.row.kind === 'gap' ? { kind: 'gap', row: block.row } : { kind: 'pair', left: block.row, right: block.row })
      continue
    }
    for (let k = 0; k < Math.max(block.removes.length, block.adds.length); k++) {
      out.push({ kind: 'pair', left: block.removes[k] ?? null, right: block.adds[k] ?? null })
    }
  }
  return out
}
