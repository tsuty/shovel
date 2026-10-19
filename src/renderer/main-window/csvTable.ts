import Papa from 'papaparse'

/** CSV / TSV の「表示」で表として描く内容。 */
export interface CsvTableData {
  /** 列の見出し。1行目を見出しにしないとき、または見出しが空の列は A, B, C…。 */
  headers: string[]
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

/** レコードを表にする。`firstRowIsHeader` なら1行目を見出しにする。 */
export function toCsvTable(records: string[][], firstRowIsHeader: boolean): CsvTableData {
  const columnCount = records.reduce((max, record) => Math.max(max, record.length), 0)
  const headerRecord = firstRowIsHeader ? records[0] : undefined
  const headers = Array.from({ length: columnCount }, (_, i) => headerRecord?.[i] || columnLabel(i))
  const body = firstRowIsHeader ? records.slice(1) : records
  const offset = firstRowIsHeader ? 2 : 1
  return {
    headers,
    rows: body.map((record, i) => ({
      rowNumber: i + offset,
      cells: record.length === columnCount ? record : [...record, ...Array<string>(columnCount - record.length).fill('')]
    }))
  }
}

const HEADER_STORAGE_PREFIX = 'shovel.csvFirstRowIsHeader:'

/** 「1行目を見出しにする」の設定。既定は見出しにする（ファイルごとに覚えるのは既定と違うときだけ）。 */
export function loadFirstRowIsHeader(projectId: string, relPath: string): boolean {
  return localStorage.getItem(`${HEADER_STORAGE_PREFIX}${projectId}:${relPath}`) !== 'false'
}

export function saveFirstRowIsHeader(projectId: string, relPath: string, value: boolean): void {
  const key = `${HEADER_STORAGE_PREFIX}${projectId}:${relPath}`
  if (value) localStorage.removeItem(key)
  else localStorage.setItem(key, 'false')
}
