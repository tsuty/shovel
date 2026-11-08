import type { TranscriptImage } from '@shared/types/transcript'

/** 表示する画像の上限（デコード後のバイト数）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 先頭のバイト列（マジックナンバー）で見分ける、表示できる画像の形式。 */
const SIGNATURES: { mimeType: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    mimeType: 'image/png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  { mimeType: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  {
    mimeType: 'image/webp',
    matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
]

/**
 * ACP の `image` コンテンツ（base64 の `data` と `mimeType`）を、トランスクリプトに載せる形にする。
 * 形式は `mimeType` ではなくバイト列で判定し、表示できない（知らない形式・大きすぎる・壊れている）
 * ときは `data` を持たない（プレースホルダとして描かれる）。
 */
export function toTranscriptImage(data: string, mimeType: string): TranscriptImage {
  const placeholder: TranscriptImage = { mimeType }
  // base64 の長さから、デコードする前に大きさを見積もる。
  if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES + 2) return placeholder
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return placeholder
  const detected = SIGNATURES.find((signature) => signature.matches(bytes))
  if (!detected) return placeholder
  return { mimeType: detected.mimeType, data: bytes.toString('base64') }
}
