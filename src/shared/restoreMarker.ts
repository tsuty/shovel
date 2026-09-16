/**
 * decisions.md C-1/C-2 の復元戦略表の「非対応」の行: エージェントが
 * `session/load` も `session/resume` も持たないとき、履歴は再開できない。
 * その状況を renderer 側で「環境のエラー」ではなく「この履歴は読むだけ」
 * として案内するための目印。main（`src/main/acp/connection.ts`）が投げ、
 * renderer（`HistoryView`）が受け取る。
 */
export const RESTORE_UNSUPPORTED_MARKER = 'RESTORE_UNSUPPORTED'

/**
 * Electron は `ipcMain.handle` が投げた Error を renderer へ渡すとき
 * "Error invoking remote method '...': Error: <元の message>" の形に包む。
 * 目印は完全一致では拾えないので、`sbxErrors.ts` と同じく部分一致で判定する。
 */
export function isRestoreUnsupportedMessage(message: string): boolean {
  return message.includes(RESTORE_UNSUPPORTED_MARKER)
}
