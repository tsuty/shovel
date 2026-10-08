/** ファイラーの IPC 契約。 */

export interface FsEntry {
  /** プロジェクトルートからの相対パス（POSIX 区切り）。ノードの一意な id にも使う。 */
  relPath: string
  name: string
  isDir: boolean
  /** `.gitignore` に一致する（node_modules 等）。 */
  ignored: boolean
}

/** テキストファイルの文字コード（判定できたもの）。`unknown` は UTF-8 として無理に読んだもの。 */
export type TextEncoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE' | 'Shift_JIS' | 'unknown'

/** 改行コード。`none` は改行を含まない、`mixed` は複数が混在する。 */
export type LineEnding = 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none'

/** そのまま書き戻せる（UTF-8 で保存しても中身が変わらない）文字コード。 */
export function isWritableEncoding(encoding: TextEncoding): boolean {
  return encoding === 'UTF-8' || encoding === 'UTF-8 BOM'
}

export type FileReadResult =
  | {
      kind: 'text'
      /** 改行は LF に揃えてある（元の改行コードは `lineEnding`。書き戻すときに main 側で元に戻す）。 */
      content: string
      /** ディスク上のバイト数。 */
      size: number
      encoding: TextEncoding
      lineEnding: LineEnding
    }
  | {
      kind: 'image'
      dataUrl: string
      /** ディスク上のバイト数。 */
      size: number
    }
  | { kind: 'binary' }
  | { kind: 'missing' }

/** ファイラーの中身検索で返す最大件数。これに達したら打ち切る。 */
export const FILE_SEARCH_MAX_RESULTS = 100

/** ファイラーの中身検索の1件（1ファイルにつき最初の一致だけ）。 */
export interface FileSearchResult {
  relPath: string
  /** 一致箇所。1 始まり。列は改行を LF に揃えた中身での文字（UTF-16）単位。 */
  line: number
  column: number
  length: number
  /** 一致を含む行（長ければ前後を「…」で切る）。`match` を太字にする。 */
  snippet: { before: string; match: string; after: string }
}

export interface FsMutationRequest {
  projectId: string
  relPath: string
}
