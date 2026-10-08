import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** ホバーしてからツールチップを出すまでの待ち（ms）。 */
const SHOW_DELAY_MS = 400
/** `title` から移した説明文を持つ属性。 */
const TIP_ATTR = 'data-tip'
/** 対象の要素とツールチップの間隔、画面の端との余白（px）。 */
const GAP = 6
const EDGE = 4

function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  return node.closest<HTMLElement>(`[title], [${TIP_ATTR}]`)
}

/**
 * 要素の `title` を `data-tip` へ移し（ネイティブのツールチップを出さないため）、説明文を返す。
 * アイコンだけのボタンなど中身に文字が無い要素は、読み上げ用の名前を失わないよう `aria-label` にも写す。
 * React が `title` を書き換えた後は、次のホバーで新しい値を移し直す。
 */
function takeTip(el: HTMLElement): string {
  const title = el.getAttribute('title')
  if (title === null) return el.getAttribute(TIP_ATTR) ?? ''
  el.removeAttribute('title')
  if (!title) {
    el.removeAttribute(TIP_ATTR)
    return ''
  }
  el.setAttribute(TIP_ATTR, title)
  if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title)
  return title
}

/**
 * ウィンドウ全体の `title` 属性を、ネイティブのツールチップの代わりに自前で描く。各ウィンドウのルートに1つ置く。
 * マウスを乗せて少し待つか、キーボードでフォーカスしたときに出す。説明文の改行（`\n`）はそのまま改行にする。
 */
export function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: HTMLElement | null = null

    function hide(): void {
      clearTimeout(timer)
      current = null
      setTip(null)
    }
    function show(el: HTMLElement, delay: number): void {
      if (el === current) return
      hide()
      const text = takeTip(el)
      if (!text) return
      current = el
      timer = setTimeout(() => {
        if (current === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() })
      }, delay)
    }

    function onPointerOver(e: PointerEvent): void {
      const el = tipTarget(e.target)
      if (el) show(el, SHOW_DELAY_MS)
      else if (current) hide()
    }
    function onPointerOut(e: PointerEvent): void {
      // ウィンドウの外へ出たとき。
      if (e.relatedTarget === null) hide()
    }
    function onFocusIn(e: FocusEvent): void {
      // クリックでのフォーカスでは出さず、キーボードで移ってきたときだけ出す。
      if (!(e.target instanceof Element) || !e.target.matches(':focus-visible')) return
      const el = tipTarget(e.target)
      if (el) show(el, 0)
    }
    function onFocusOut(e: FocusEvent): void {
      if (current && e.target instanceof Node && current.contains(e.target)) hide()
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // 対象の下に出し、下に収まらなければ上に出す。左右は画面からはみ出さないよう寄せる。
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!tip || !el) {
      setPos(null)
      return
    }
    const { width, height } = el.getBoundingClientRect()
    let top = tip.rect.bottom + GAP
    if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, tip.rect.top - GAP - height)
    const left = Math.max(EDGE, Math.min(tip.rect.left, window.innerWidth - width - EDGE))
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className="pointer-events-none fixed z-[1000] w-max max-w-xs whitespace-pre-line break-words rounded-md border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
