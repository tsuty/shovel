import type { DraftInsertion } from '@shared/chatDraft'

/**
 * ファイラーの「コンテキストに追加」やブラウザの右クリックの「チャットへ渡す項目」を、
 * 宛先のタブ（SessionView）が登録したハンドラへ届ける簡易 pub-sub。
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

const insertHandlers = new Map<string, (insertion: DraftInsertion) => void>()

export function registerInsertHandler(sessionId: string, fn: (insertion: DraftInsertion) => void): () => void {
  insertHandlers.set(sessionId, fn)
  return () => {
    if (insertHandlers.get(sessionId) === fn) insertHandlers.delete(sessionId)
  }
}

/** セッションの入力欄の今の内容の後ろに文字を足す。 */
export function insertTextToSession(sessionId: string, insertion: DraftInsertion): boolean {
  const fn = insertHandlers.get(sessionId)
  if (!fn) return false
  fn(insertion)
  return true
}

const focusHandlers = new Map<string, () => void>()

export function registerFocusHandler(sessionId: string, fn: () => void): () => void {
  focusHandlers.set(sessionId, fn)
  return () => {
    if (focusHandlers.get(sessionId) === fn) focusHandlers.delete(sessionId)
  }
}

/** セッションの入力欄にフォーカスを移す。 */
export function focusSessionInput(sessionId: string): boolean {
  const fn = focusHandlers.get(sessionId)
  if (!fn) return false
  fn()
  return true
}
