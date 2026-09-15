/**
 * ui.md §7「追加はファイラーの右クリック→『コンテキストに追加』」。
 * ファイラーはどのセッションタブにも属さないグローバルなサイドパネルなので、
 * 「今アクティブなタブへ追加する」という操作を、タブ側（Composer を持つ
 * SessionView）が登録したハンドラへ委譲する簡易 pub-sub で実現する
 * （editorRegistry.ts と同じパターン）。
 */
const handlers = new Map<string, (relPath: string) => void>()

export function registerAttachHandler(sessionId: string, fn: (relPath: string) => void): () => void {
  handlers.set(sessionId, fn)
  return () => {
    if (handlers.get(sessionId) === fn) handlers.delete(sessionId)
  }
}

export function addAttachmentToSession(sessionId: string, relPath: string): boolean {
  const fn = handlers.get(sessionId)
  if (!fn) return false
  fn(relPath)
  return true
}
