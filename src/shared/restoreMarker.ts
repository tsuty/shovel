/**
 * エージェントが `session/load` も `session/resume` も持たず、履歴を再開できないことを
 * renderer へ伝える Error の message に使う目印。
 */
export const RESTORE_UNSUPPORTED_MARKER = 'RESTORE_UNSUPPORTED'

/** IPC で包まれた Error の message に目印が含まれるかを部分一致で判定する。 */
export function isRestoreUnsupportedMessage(message: string): boolean {
  return message.includes(RESTORE_UNSUPPORTED_MARKER)
}
