import iconv from 'iconv-lite'
import { isWritableEncoding, type LineEnding, type TextEncoding } from '@shared/types/filer'

/**
 * テキストファイルの文字コード・改行コードの判定と、書き戻し時の復元。
 * 読むときに LF へ正規化し、書くときにディスク上の元の改行コードと BOM へ戻す。
 */

const BINARY_SNIFF_BYTES = 8000

export type DecodedText =
  | { kind: 'text'; content: string; encoding: TextEncoding; lineEnding: LineEnding }
  | { kind: 'binary' }

function tryDecode(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 先頭数 KB の NULL バイトでバイナリを判定する。UTF-16 は BOM を先に見て振り分ける。 */
export function decodeText(buffer: Buffer): DecodedText {
  let encoding: TextEncoding
  let raw: string
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = 'UTF-8 BOM'
    raw = buffer.subarray(3).toString('utf8')
  } else if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'UTF-16 LE'
    raw = new TextDecoder('utf-16le').decode(buffer.subarray(2))
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'UTF-16 BE'
    raw = new TextDecoder('utf-16be').decode(buffer.subarray(2))
  } else {
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'binary' }
    const utf8 = tryDecode('utf-8', buffer)
    const sjis = utf8 === null ? tryDecode('shift_jis', buffer) : null
    if (utf8 !== null) {
      encoding = 'UTF-8'
      raw = utf8
    } else if (sjis !== null) {
      encoding = 'Shift_JIS'
      raw = sjis
    } else {
      encoding = 'unknown'
      raw = buffer.toString('utf8')
    }
  }
  return { kind: 'text', content: raw.replace(/\r\n?/g, '\n'), encoding, lineEnding: detectLineEnding(raw) }
}

export function detectLineEnding(text: string): LineEnding {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  if (kinds === 0) return 'none'
  if (kinds > 1) return 'mixed'
  return crlf > 0 ? 'CRLF' : cr > 0 ? 'CR' : 'LF'
}

/** 混在しているファイルは LF と CRLF の多い方に揃える。 */
function dominantLineEnding(text: string): '\n' | '\r\n' {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? '\r\n' : '\n'
}

/** Shift_JIS で表せない文字が含まれていて書き込めない。位置は LF に揃えた内容での 1 始まりの行・列（UTF-16 単位）。 */
export class UnencodableTextError extends Error {
  constructor(
    readonly line: number,
    readonly column: number,
    readonly char: string
  ) {
    super(`character ${JSON.stringify(char)} at ${line}:${column} cannot be encoded in Shift_JIS`)
  }
}

/**
 * Shift_JIS（読み込みと同じ CP932 / Windows-31J）のバイト列にする。読み直して元に戻らない文字
 * （絵文字など）があれば、最初のものの位置を付けて `UnencodableTextError` を投げる。
 */
function encodeShiftJis(text: string): Buffer {
  const bytes = iconv.encode(text, 'cp932')
  if (tryDecode('shift_jis', bytes) === text) return bytes
  for (const [i, line] of text.split('\n').entries()) {
    let column = 1
    for (const char of line) {
      if (tryDecode('shift_jis', iconv.encode(char, 'cp932')) !== char) {
        throw new UnencodableTextError(i + 1, column, char)
      }
      column += char.length
    }
  }
  throw new UnencodableTextError(1, 1, '')
}

/**
 * LF に揃えた編集内容を、既存ファイル（`existing`、新規なら null）の文字コード・改行コード・BOM に
 * 合わせてバイト列にする。書き込めるのは UTF-8（BOM の有無）と Shift_JIS で、それ以外の既存ファイルへの
 * 上書きは拒否する。
 */
export function encodeForWrite(content: string, existing: Buffer | null): Buffer {
  const normalized = content.replace(/\r\n?/g, '\n')
  if (!existing) return Buffer.from(normalized, 'utf8')
  const decoded = decodeText(existing)
  if (decoded.kind === 'binary' || !isWritableEncoding(decoded.encoding)) {
    throw new Error('refusing to overwrite a file that is not UTF-8 or Shift_JIS text')
  }
  const eol =
    decoded.lineEnding === 'none' ? '\n' : decoded.lineEnding === 'CR' ? '\r' : dominantLineEnding(existing.toString('latin1'))
  if (decoded.encoding === 'Shift_JIS') {
    // 改行の位置を保ったまま検査できるよう、改行を戻す前に変換する（改行のバイトは Shift_JIS でも同じ）。
    const body = encodeShiftJis(normalized)
    return eol === '\n' ? body : Buffer.from(body.toString('latin1').replace(/\n/g, eol), 'latin1')
  }
  const body = Buffer.from(eol === '\n' ? normalized : normalized.replace(/\n/g, eol), 'utf8')
  return decoded.encoding === 'UTF-8 BOM' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}
