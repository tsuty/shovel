/**
 * ファイラーの「コンテキストに追加」を、アクティブなタブ（SessionView）が登録したハンドラへ
 * 届ける簡易 pub-sub。
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
