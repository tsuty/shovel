import type { Mermaid } from 'mermaid'

/**
 * Markdown の ```mermaid ブロックを図にする（`MermaidDialog` から使う）。
 * mermaid は `preloadMermaid` で裏で読み込んでおく。
 */
let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
    // 読み込みに失敗したら次の呼び出しでやり直せるようにする。
    mermaidPromise.catch(() => {
      mermaidPromise = null
    })
  }
  return mermaidPromise
}

/** 画面の描画が落ち着いてから、裏で読み込んでおく。 */
export function preloadMermaid(): void {
  const start = (): void => void loadMermaid().catch(() => {})
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 })
  else setTimeout(start, 2000)
}

let renderCount = 0

/**
 * コードを SVG 文字列にする。文法エラーなら例外（メッセージは mermaid のもの）。
 * `securityLevel: 'strict'` で図の中の HTML・クリック時のスクリプトを無効にする。
 */
export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const mermaid = await loadMermaid()
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
  const id = `shovel-mermaid-${++renderCount}`
  try {
    await mermaid.parse(code)
    const { svg } = await mermaid.render(id, code)
    return svg
  } finally {
    // 失敗時に mermaid が body 直下へ残す一時要素を片付ける。
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}
