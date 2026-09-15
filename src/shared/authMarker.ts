/**
 * flows.md §1-2: 接続確立中に ACP の認証エラー（RequestError.authRequired,
 * JSON-RPC code -32000）を main 側で検知したとき、renderer へ投げ直す
 * Error の message に使う目印。main と renderer の両方から参照するため
 * shared に置く。main 側は `src/main/acp/connection.ts` で使う。
 */
export const AUTH_REQUIRED_MARKER = 'AUTH_REQUIRED'
