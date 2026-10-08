import { offsetAt } from './textEditing'

/**
 * ファイルを開いたときに、指定の位置（中身検索で当たった箇所）へ移る指示。
 * `nonce` は同じ位置へもう一度移るときにも効かせるための通し番号。
 */
export interface FileReveal {
  /** 1 始まり。列は改行を LF に揃えた中身での文字（UTF-16）単位。 */
  line: number
  column: number
  length: number
  nonce: number
}

const HIGHLIGHT = 'shovel-reveal'

/**
 * shiki で描いた表示（`.line` が1行ずつ並ぶ）の中で、一致箇所を塗って画面の中央へ寄せる。
 * 塗りは CSS Custom Highlight API（DOM を書き換えない）で、次に別の箇所へ移るまで残す。
 * その行が無ければ false。
 */
export function revealInHighlightedCode(container: HTMLElement, reveal: FileReveal): boolean {
  const lineEl = container.querySelectorAll<HTMLElement>('.line')[reveal.line - 1]
  if (!lineEl) return false
  lineEl.scrollIntoView({ block: 'center' })
  const range = rangeInElement(lineEl, reveal.column - 1, reveal.length)
  if (range && 'highlights' in CSS) CSS.highlights.set(HIGHLIGHT, new Highlight(range))
  return true
}

/** textarea で一致箇所を選択し、その行が見えるようにスクロールする。 */
export function revealInTextarea(area: HTMLTextAreaElement, reveal: FileReveal): void {
  const start = offsetAt(area.value, reveal.line, reveal.column)
  const end = Math.min(start + reveal.length, area.value.length)
  area.focus()
  area.setSelectionRange(start, end)
  // 折り返さないとき（行番号付き）は行の高さから位置が決まる。折り返すときは選択の手前までの
  // 内容を同じ幅の textarea に入れて高さを測る（行の折り返しで位置がずれるため）。
  const style = getComputedStyle(area)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  let top: number
  if (area.wrap === 'off') {
    top = (reveal.line - 1) * lineHeight
  } else {
    const probe = area.cloneNode() as HTMLTextAreaElement
    probe.value = area.value.slice(0, start)
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', height: '0', width: `${area.clientWidth}px` })
    area.parentElement?.appendChild(probe)
    top = probe.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - lineHeight
    probe.remove()
  }
  area.scrollTop = Math.max(0, top - area.clientHeight / 2)
}

/** 要素のテキストの `[start, start + length)` を指す Range（テキストノードをまたいでよい）。 */
function rangeInElement(el: HTMLElement, start: number, length: number): Range | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let started = false
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const nodeEnd = offset + node.data.length
    if (!started && start < nodeEnd) {
      range.setStart(node, start - offset)
      started = true
    }
    if (started && start + length <= nodeEnd) {
      range.setEnd(node, start + length - offset)
      return range
    }
    offset = nodeEnd
  }
  return null
}
