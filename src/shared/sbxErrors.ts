/**
 * decisions.md A-3-1「エラーは『環境が悪い』ではなく『こうすれば直る』を示す」。
 * `spawn('sbx', ...)` が ENOENT で失敗したとき（`sbx` が PATH に無い）、
 * Node の生のエラー（`Error: spawn sbx ENOENT`）をそのまま IPC 経由で
 * renderer に見せない。main 側でこのマーカーへ変換し、renderer 側で
 * 案内文言に差し替える。
 */
export const SBX_NOT_FOUND_MARKER = 'SBX_NOT_FOUND'

export function isSbxNotFoundMessage(message: string): boolean {
  return message === SBX_NOT_FOUND_MARKER || message.includes(SBX_NOT_FOUND_MARKER)
}
