/** ACP の認証エラー（JSON-RPC code -32000）を renderer へ伝える Error の message に使う目印。 */
export const AUTH_REQUIRED_MARKER = 'AUTH_REQUIRED'

/** IPC で包まれた Error の message に目印が含まれるかを部分一致で判定する。 */
export function isAuthRequiredMessage(message: string): boolean {
  return message.includes(AUTH_REQUIRED_MARKER)
}
