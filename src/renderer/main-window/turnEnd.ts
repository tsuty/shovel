/**
 * ターン終了の通知。ファイラーやビューア／エディタが読み直しのきっかけに購読する。
 * 同じウィンドウの複数タブが続けてターンを終えたときは、まとめて1回にする。
 */

/** 立て続けのターン終了をまとめる待ち時間。 */
export const TURN_END_DEBOUNCE_MS = 300

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

export function onTurnEnd(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyTurnEnd(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    for (const listener of [...listeners]) listener()
  }, TURN_END_DEBOUNCE_MS)
}
