/**
 * flows.md §4 / decisions.md N-5: プロンプト送信時に、開いている Markdown
 * エディタの未保存編集を autosave のデバウンス待ちを飛ばしてディスクへ
 * フラッシュする。エージェントは IDE のバッファではなくディスクを読むため。
 * ウィンドウ内に複数のエディタタブが同時に存在しうるので、モジュール単位の
 * 簡易 pub-sub で束ねる。
 */
const flushers = new Set<() => void>()

export function registerFlush(fn: () => void): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export function flushAllEditors(): void {
  for (const fn of flushers) fn()
}
