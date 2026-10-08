import { createContext, useContext, useLayoutEffect } from 'react'

/**
 * 非同期の描画（Mermaid の図・shiki のハイライト）が終わったかを数える。
 * Provider が無い画面（通常のプレビュー・トランスクリプト）では何もしない。
 */
export interface RenderTracker {
  /** 描画中の要素を1つ増やす。戻り値を呼ぶと減らす（2回目以降は無視）。 */
  begin(): () => void
}

export const RenderTrackerContext = createContext<RenderTracker | null>(null)

/**
 * `pending` の間、描画中として数える。描画前の1フレームで「終わった」と見えないよう、
 * 描画より前（layout effect）に数える。
 */
export function usePendingRender(pending: boolean): void {
  const tracker = useContext(RenderTrackerContext)
  useLayoutEffect(() => {
    if (!tracker || !pending) return
    return tracker.begin()
  }, [tracker, pending])
}
