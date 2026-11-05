import { toTsv, type CsvTableData } from './csvTable'

/** 表の中のセルの位置。`row` は表示の順（並べ替えた後）の位置、`col` は左からの列の位置。どちらも 0 始まり。 */
export interface CellPos {
  row: number
  col: number
}

/**
 * 選んだ範囲の1つ。`anchor` は選び始めたセル、`focus` は Shift やドラッグで伸ばした先のセル。
 * `rows` は行全体（列は端から端まで）、`columns` は列全体（行は上から下まで）で、使わない向きの位置は無視する。
 */
export interface CellRange {
  kind: 'cells' | 'rows' | 'columns'
  anchor: CellPos
  focus: CellPos
}

/** 選んでいる範囲の並び。最後のものが今操作している範囲で、その `anchor` が今のセル。 */
export type CellSelection = readonly CellRange[]

/** 表の大きさ（表示している行の数と列の数）。 */
export interface GridSize {
  rows: number
  cols: number
}

/** 範囲が覆う行・列の位置（両端を含む）。 */
export interface Bounds {
  top: number
  bottom: number
  left: number
  right: number
}

export function rangeBounds(range: CellRange, size: GridSize): Bounds {
  const top = range.kind === 'columns' ? 0 : Math.min(range.anchor.row, range.focus.row)
  const bottom = range.kind === 'columns' ? size.rows - 1 : Math.max(range.anchor.row, range.focus.row)
  const left = range.kind === 'rows' ? 0 : Math.min(range.anchor.col, range.focus.col)
  const right = range.kind === 'rows' ? size.cols - 1 : Math.max(range.anchor.col, range.focus.col)
  return { top, bottom, left, right }
}

/** 各範囲の覆う行・列の位置。描画のたびに範囲ごとに計算し直さないよう、先にまとめて求めておく。 */
export function selectionBounds(selection: CellSelection, size: GridSize): Bounds[] {
  return selection.map((range) => rangeBounds(range, size))
}

export function boundsContain(bounds: readonly Bounds[], row: number, col: number): boolean {
  return bounds.some((b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right)
}

export function boundsCoverRow(bounds: readonly Bounds[], row: number): boolean {
  return bounds.some((b) => row >= b.top && row <= b.bottom)
}

export function boundsCoverColumn(bounds: readonly Bounds[], col: number): boolean {
  return bounds.some((b) => col >= b.left && col <= b.right)
}

/** 表の中に収める。 */
export function clampPos(pos: CellPos, size: GridSize): CellPos {
  return {
    row: Math.max(0, Math.min(size.rows - 1, pos.row)),
    col: Math.max(0, Math.min(size.cols - 1, pos.col))
  }
}

/**
 * セル・行番号・見出しを押したときの選択。`target` は押した場所の種類で、`rows` なら `pos.row`、`columns` なら
 * `pos.col` だけが意味を持つ。Shift なら今の範囲を押した位置まで伸ばし（範囲の種類は押した場所に合わせる。
 * セルを選んでから Shift で行番号を押すと、その間の行全体になる）、Cmd/Ctrl なら範囲を足し、
 * どちらでもなければ押した場所だけを選び直す。
 */
export function pressAt(
  selection: CellSelection,
  target: CellRange['kind'],
  pos: CellPos,
  modifiers: { shift: boolean; add: boolean }
): CellSelection {
  const last = selection.at(-1)
  if (modifiers.shift && last) {
    return [...selection.slice(0, -1), { kind: target, anchor: last.anchor, focus: pos }]
  }
  const range: CellRange = { kind: target, anchor: pos, focus: pos }
  return modifiers.add ? [...selection, range] : [range]
}

/** ドラッグで今の範囲の先を `pos` まで動かす。 */
export function dragTo(selection: CellSelection, pos: CellPos): CellSelection {
  const last = selection.at(-1)
  if (!last || (last.focus.row === pos.row && last.focus.col === pos.col)) return selection
  return [...selection.slice(0, -1), { ...last, focus: pos }]
}

/** すべてのセル（見出しを付けてコピーできるよう、全部の列として選ぶ）。 */
export function selectAll(size: GridSize): CellSelection {
  if (size.rows === 0 || size.cols === 0) return []
  return [{ kind: 'columns', anchor: { row: 0, col: 0 }, focus: { row: size.rows - 1, col: size.cols - 1 } }]
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/**
 * 矢印キーでの移動。`extend`（Shift）なら今の範囲の先を動かし、そうでなければ今のセルを動かして
 * そのセルだけを選ぶ。`toEdge`（Cmd/Ctrl）なら表の端まで動かす。
 */
export function moveBy(
  selection: CellSelection,
  key: ArrowKey,
  modifiers: { extend: boolean; toEdge: boolean },
  size: GridSize
): CellSelection {
  const last = selection.at(-1)
  if (!last || size.rows === 0 || size.cols === 0) return selection
  const from = modifiers.extend ? last.focus : last.anchor
  const far = modifiers.toEdge ? Math.max(size.rows, size.cols) : 1
  const delta = {
    ArrowUp: { row: -far, col: 0 },
    ArrowDown: { row: far, col: 0 },
    ArrowLeft: { row: 0, col: -far },
    ArrowRight: { row: 0, col: far }
  }[key]
  const pos = clampPos({ row: from.row + delta.row, col: from.col + delta.col }, size)
  if (modifiers.extend) return [...selection.slice(0, -1), { ...last, focus: pos }]
  return [{ kind: 'cells', anchor: pos, focus: pos }]
}

/** コピーする中身。`rows` は表示の順の位置、`columns` は列の位置で、どちらも上・左からの順。 */
export interface CopyPlan {
  rows: number[]
  columns: number[]
  /** 列全体だけを選んでいるとき。見出しの行があれば全部を先頭に付ける。 */
  withHeader: boolean
}

function span(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

function union(lists: number[][]): number[] {
  return [...new Set(lists.flat())].sort((a, b) => a - b)
}

/**
 * 選んでいる範囲をどう並べてコピーするか。範囲が1つならその矩形。複数なら、行の位置が揃っていれば列を
 * 左から並べ、列の位置が揃っていれば行を上から並べる（Excel と同じ）。どちらでもなければコピーできない（null）。
 */
export function copyPlan(selection: CellSelection, size: GridSize): CopyPlan | null {
  if (selection.length === 0 || size.rows === 0 || size.cols === 0) return null
  const bounds = selectionBounds(selection, size)
  const first = bounds[0]!
  const withHeader = selection.every((range) => range.kind === 'columns')
  const sameRows = bounds.every((b) => b.top === first.top && b.bottom === first.bottom)
  if (sameRows) {
    return {
      rows: span(first.top, first.bottom),
      columns: union(bounds.map((b) => span(b.left, b.right))),
      withHeader
    }
  }
  const sameColumns = bounds.every((b) => b.left === first.left && b.right === first.right)
  if (sameColumns) {
    return {
      rows: union(bounds.map((b) => span(b.top, b.bottom))),
      columns: span(first.left, first.right),
      withHeader
    }
  }
  return null
}

/**
 * コピーの中身を TSV にする（表計算ソフトに貼れる形）。`order` は表示の順に並べた `data.rows` の位置。
 */
export function planToTsv(data: CsvTableData, order: readonly number[], plan: CopyPlan): string {
  const records = plan.rows.map((position) => {
    const cells = data.rows[order[position] ?? -1]?.cells
    return plan.columns.map((c) => cells?.[c] ?? '')
  })
  if (plan.withHeader) {
    records.unshift(...data.headerRows.map((row) => plan.columns.map((c) => row.cells[c] ?? '')))
  }
  return toTsv(records)
}
