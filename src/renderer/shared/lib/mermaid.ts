import type { Mermaid } from 'mermaid'

/**
 * Markdown の ```mermaid ブロックを図にする。図はトランスクリプトの中には
 * 描かず、コードブロックのボタンから開くポップアップでだけ描く
 * （`MermaidDialog`）。こうすると、ストリーミング中の書きかけの図・非表示の
 * タブでの寸法崩れ・テーマの切り替えを気にせずに済む（開いた時点の確定した
 * コードを、その時点のテーマで描く）。
 *
 * mermaid は大きいので起動時には読み込まず、プロジェクトのウィンドウが
 * 開いた後の空き時間に読み込んでおく（`preloadMermaid`）。
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
 * `securityLevel: 'strict'`: 図の中の HTML・クリック時のスクリプトを無効にする
 * （生の HTML を描かないというアプリの方針に合わせる）。
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
