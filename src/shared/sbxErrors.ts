/** `sbx` が PATH に無い（spawn が ENOENT）ことを renderer へ伝える Error の message に使う目印。 */
export const SBX_NOT_FOUND_MARKER = 'SBX_NOT_FOUND'

export function isSbxNotFoundMessage(message: string): boolean {
  return message === SBX_NOT_FOUND_MARKER || message.includes(SBX_NOT_FOUND_MARKER)
}
