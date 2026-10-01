import type { LineEnding, TextEncoding } from '@shared/types/filer'

/**
 * テキストファイルの文字コード・改行コードの判定と、書き戻し時の復元。
 * エディタ（textarea）は改行を LF に揃えてしまうため、読むときに LF へ
 * 正規化し、書くときにディスク上の元の改行コードと BOM へ戻す。そうしないと
 * CRLF のファイルを1文字直しただけで全行の改行が書き換わってしまう。
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

/**
 * decisions.md N-3-2: バイナリ判定は先頭数 KB の NULL バイトで行う。ただし
 * UTF-16 は NULL バイトを含むのが普通なので、BOM を先に見て振り分ける。
 */
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

/** 混在しているファイルは多い方に揃える（CR 単独は稀なので LF と CRLF だけで比べる）。 */
function dominantLineEnding(text: string): '\n' | '\r\n' {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? '\r\n' : '\n'
}

/**
 * LF に揃えた編集内容を、ディスク上の既存ファイル（`existing`、新規なら null）
 * の改行コード・BOM に合わせてバイト列にする。UTF-8 で読めないファイル
 * （Shift_JIS・UTF-16 等）への上書きは、中身を壊すので拒否する。
 */
export function encodeForWrite(content: string, existing: Buffer | null): Buffer {
  const normalized = content.replace(/\r\n?/g, '\n')
  if (!existing) return Buffer.from(normalized, 'utf8')
  const decoded = decodeText(existing)
  if (decoded.kind === 'binary' || (decoded.encoding !== 'UTF-8' && decoded.encoding !== 'UTF-8 BOM')) {
    throw new Error('refusing to overwrite a file that is not UTF-8 text')
  }
  const eol = decoded.lineEnding === 'none' ? '\n' : dominantLineEnding(existing.toString('utf8'))
  const body = Buffer.from(eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized, 'utf8')
  return decoded.encoding === 'UTF-8 BOM' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}
