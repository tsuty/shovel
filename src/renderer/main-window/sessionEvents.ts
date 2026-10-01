import type { TranscriptEvent } from '@shared/types/transcript'

/**
 * main から届くトランスクリプトイベントを sessionId ごとに振り分ける。
 * タブの `SessionView` が購読を始める前に届いた分は溜めておき、購読時にまとめて渡す。
 */

type Listener = (event: TranscriptEvent) => void

/** 購読されないまま溜まり続けるのを防ぐ上限（1セッションあたり）。 */
const MAX_BUFFERED = 20_000

const listeners = new Map<string, Listener>()
const buffered = new Map<string, TranscriptEvent[]>()

window.shovel.session.onEvent(({ sessionId, event }) => {
  const listener = listeners.get(sessionId)
  if (listener) {
    listener(event)
    return
  }
  const queue = buffered.get(sessionId) ?? []
  if (queue.length < MAX_BUFFERED) queue.push(event)
  buffered.set(sessionId, queue)
})

export function subscribeSessionEvents(sessionId: string, listener: Listener): () => void {
  listeners.set(sessionId, listener)
  const queue = buffered.get(sessionId)
  buffered.delete(sessionId)
  if (queue) for (const event of queue) listener(event)
  return () => {
    if (listeners.get(sessionId) === listener) listeners.delete(sessionId)
  }
}

/** タブを閉じたときに、購読前に溜まった分が残っていれば捨てる。 */
export function discardSessionEvents(sessionId: string): void {
  buffered.delete(sessionId)
}
