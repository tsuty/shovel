/**
 * ターン終了の通知（decisions.md N-3-6 (A)(B)）。エージェントがファイルを変えたかもしれないので、
 * ファイラーは展開中のフォルダを、開いているファイルのビューア／エディタは中身を読み直す。
 * 同じウィンドウ（= 同じプロジェクト）の複数タブが続けてターンを終えたときは、まとめて1回にする。
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
