/**
 * 開いている Markdown エディタの未保存編集を、自動保存の待ちを飛ばしてディスクへ書き出す。
 * ウィンドウ内の複数のエディタをモジュール単位の簡易 pub-sub で束ねる。
 */
const flushers = new Set<() => Promise<void>>()

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

/** 書き込みに失敗しても送信は止めない。 */
export async function flushAllEditors(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()))
}
