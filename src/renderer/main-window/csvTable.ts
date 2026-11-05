import Papa from 'papaparse'

/** CSV / TSV の「表示」で表として描く内容。 */
export interface CsvTableData {
  /** 列の名前。見出しの最後の行の値で、見出しが無いとき、またはその値が空の列は A, B, C…。 */
  headers: string[]
  /** 見出しにした行（列の数に揃えてある）。見出しが無いときは空。 */
  headerRows: CsvRow[]
  rows: CsvRow[]
}

export interface CsvRow {
  /** ファイルの中での行（レコード）の番号。1 始まりで、見出しの行も数える（Excel の行番号と同じ）。 */
  rowNumber: number
  /** 列の数に揃えてある（足りない分は空文字）。 */
  cells: string[]
}

/** 0 始まりの列番号を A, B, …, Z, AA, AB… にする。 */
export function columnLabel(index: number): string {
  let label = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  }
  return label
}

/**
 * CSV（`,` 区切り）/ TSV（タブ区切り）をレコード（行ごとの値の並び）に分ける。引用符の中の区切り文字・改行は
 * 値の一部として扱う。書式の誤り（閉じていない引用符など）があっても、読めたところまでを返す。
 * 末尾の改行で生じる空の行は除く。
 */
export function parseCsvRecords(text: string, delimiter: ',' | '\t'): string[][] {
  const records = Papa.parse<string[]>(text, { delimiter, header: false, skipEmptyLines: false }).data
  const last = records.at(-1)
  if (last && last.length === 1 && last[0] === '') records.pop()
  return records
}

/** レコードを表にする。先頭の `headerRowCount` 行を見出しにする（ファイルの行数より多ければ全部の行）。 */
export function toCsvTable(records: string[][], headerRowCount: number): CsvTableData {
  const columnCount = records.reduce((max, record) => Math.max(max, record.length), 0)
  const headerCount = Math.min(headerRowCount, records.length)
  const lastHeader = headerCount > 0 ? records[headerCount - 1] : undefined
  const headers = Array.from({ length: columnCount }, (_, i) => lastHeader?.[i] || columnLabel(i))
  const pad = (record: string[]): string[] =>
    record.length === columnCount ? record : [...record, ...Array<string>(columnCount - record.length).fill('')]
  const toRow = (record: string[], i: number): CsvRow => ({ rowNumber: i + 1, cells: pad(record) })
  return {
    headers,
    headerRows: records.slice(0, headerCount).map(toRow),
    rows: records.slice(headerCount).map((record, i) => toRow(record, headerCount + i))
  }
}

/** レコードを TSV にする。タブ・改行・`"` を含む値は `"` で囲み、中の `"` は `""` にする（Excel と同じ）。 */
export function toTsv(records: readonly (readonly string[])[]): string {
  const quote = (value: string): string => (/[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return records.map((record) => record.map(quote).join('\t')).join('\n')
}

/** 値を幅 `maxWidth`（半角の文字数）で折り返したときの行数の見積もり。全角は半角2文字に数える。 */
export function estimateCellLines(value: string, maxWidth: number): number {
  if (value.length * 2 <= maxWidth && !value.includes('\n')) return 1
  let lines = 1
  let width = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 10) {
      lines++
      width = 0
    } else if (code !== 13) {
      const charWidth = code >= 0x2e80 ? 2 : 1
      if (width + charWidth > maxWidth) {
        lines++
        width = charWidth
      } else {
        width += charWidth
      }
    }
  }
  return lines
}

/** 各行を折り返したときの行数の見積もり（その行でいちばん行数の多いセル）。`columnWidths` は列ごとの幅（半角の文字数）。 */
export function estimateRowLines(rows: readonly CsvRow[], columnWidths: readonly number[]): Uint32Array {
  const result = new Uint32Array(rows.length)
  rows.forEach((row, index) => {
    let lines = 1
    row.cells.forEach((value, col) => {
      lines = Math.max(lines, estimateCellLines(value, columnWidths[col] ?? 1))
    })
    result[index] = lines
  })
  return result
}

/** 見出しにできる行数の上限。 */
export const MAX_HEADER_ROWS = 10

const HEADER_ROWS_STORAGE_PREFIX = 'shovel.csvHeaderRowCount:'
const LEGACY_HEADER_STORAGE_PREFIX = 'shovel.csvFirstRowIsHeader:'
const WRAP_STORAGE_PREFIX = 'shovel.csvWrapCells:'

/** 見出しの行数の設定。既定は 1。以前の「1行目を見出しにする」でオフにしたファイルは 0 として読む。 */
export function loadHeaderRowCount(projectId: string, relPath: string): number {
  const stored = localStorage.getItem(`${HEADER_ROWS_STORAGE_PREFIX}${projectId}:${relPath}`)
  const count = stored === null ? NaN : Number(stored)
  if (Number.isInteger(count) && count >= 0 && count <= MAX_HEADER_ROWS) return count
  return localStorage.getItem(`${LEGACY_HEADER_STORAGE_PREFIX}${projectId}:${relPath}`) === 'false' ? 0 : 1
}

/** ファイルごとに覚えるのは既定と違うときだけ。 */
export function saveHeaderRowCount(projectId: string, relPath: string, value: number): void {
  const key = `${HEADER_ROWS_STORAGE_PREFIX}${projectId}:${relPath}`
  localStorage.removeItem(`${LEGACY_HEADER_STORAGE_PREFIX}${projectId}:${relPath}`)
  if (value === 1) localStorage.removeItem(key)
  else localStorage.setItem(key, String(value))
}

/** セルを折り返すかの設定。既定は折り返さない。 */
export function loadWrapCells(projectId: string, relPath: string): boolean {
  return localStorage.getItem(`${WRAP_STORAGE_PREFIX}${projectId}:${relPath}`) === 'true'
}

export function saveWrapCells(projectId: string, relPath: string, value: boolean): void {
  const key = `${WRAP_STORAGE_PREFIX}${projectId}:${relPath}`
  if (value) localStorage.setItem(key, 'true')
  else localStorage.removeItem(key)
}
