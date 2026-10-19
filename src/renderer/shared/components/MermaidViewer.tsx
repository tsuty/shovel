import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoveHorizontal, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../lib/utils'
import { fitZoom, parseViewBox, stepZoom, wheelZoom, type Size, type ZoomMode } from '../lib/diagramZoom'
import { MermaidError, useMermaidSvg } from './MermaidDiagram'

/** 図の周りの余白（px）。 */
const PADDING = 12

/** 拡大率を変えるときに、画面上で動かさない点（クライアント座標）。 */
interface Anchor {
  x: number
  y: number
}

/** ドラッグを始めた時点のポインタとスクロール位置。 */
interface DragStart {
  x: number
  y: number
  left: number
  top: number
}

/**
 * Mermaid の図を、拡大・縮小・等倍・幅に合わせる・全体を表示の操作つきで見せる
 * （.mmd / .mermaid のプレビューとポップアップ）。親の高さいっぱいに広がり、自分でスクロールする。
 * 描き直しても拡大率とスクロール位置は保つ（合わせるモードなら合わせ直す）。
 */
export function MermaidViewer({ code, className }: { code: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { svg, error } = useMermaidSvg(code)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const naturalRef = useRef<Size | null>(null)
  const modeRef = useRef<ZoomMode>('fitWidth')
  const scaleRef = useRef(1)
  const dragRef = useRef<DragStart | null>(null)
  const [mode, setModeState] = useState<ZoomMode>('fitWidth')
  const [scale, setScale] = useState(1)
  const [canPan, setCanPan] = useState(false)
  const [dragging, setDragging] = useState(false)

  const setMode = useCallback((next: ZoomMode) => {
    modeRef.current = next
    setModeState(next)
  }, [])

  const updateCanPan = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    setCanPan(scroller.scrollWidth > scroller.clientWidth || scroller.scrollHeight > scroller.clientHeight)
  }, [])

  /** 図の寸法を `next` 倍にする。`anchor` を渡すと、その点の下にある図の位置を動かさない。 */
  const applyScale = useCallback(
    (next: number, anchor?: Anchor) => {
      const svgEl = hostRef.current?.querySelector('svg')
      const natural = naturalRef.current
      const scroller = scrollRef.current
      if (!svgEl || !natural || !scroller) return
      let fx = 0.5
      let fy = 0.5
      if (anchor) {
        const before = svgEl.getBoundingClientRect()
        if (before.width > 0) fx = (anchor.x - before.left) / before.width
        if (before.height > 0) fy = (anchor.y - before.top) / before.height
      }
      svgEl.setAttribute('width', String(natural.width * next))
      svgEl.setAttribute('height', String(natural.height * next))
      if (anchor) {
        const after = svgEl.getBoundingClientRect()
        scroller.scrollLeft += after.left + fx * after.width - anchor.x
        scroller.scrollTop += after.top + fy * after.height - anchor.y
      }
      scaleRef.current = next
      setScale(next)
      updateCanPan()
    },
    [updateCanPan]
  )

  /** 合わせるモードなら、今の表示領域に合わせ直す。 */
  const refit = useCallback(() => {
    const scroller = scrollRef.current
    const natural = naturalRef.current
    const current = modeRef.current
    if (!scroller || !natural) return
    if (current === 'manual') {
      updateCanPan()
      return
    }
    const box = { width: scroller.clientWidth - PADDING * 2, height: scroller.clientHeight - PADDING * 2 }
    if (box.width <= 0 || box.height <= 0) return
    applyScale(fitZoom(current, natural, box))
  }, [applyScale, updateCanPan])

  // 描き直した SVG を、今の拡大率の寸法にしてから差し替える（スクロール位置が飛ばないように）。
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !svg) return
    const template = document.createElement('template')
    // mermaid が securityLevel: 'strict' で生成した SVG（スクリプト・生 HTML は含まない）。
    template.innerHTML = svg
    const svgEl = template.content.querySelector('svg')
    if (!svgEl) return
    const natural = parseViewBox(svgEl.getAttribute('viewBox'))
    naturalRef.current = natural
    svgEl.style.maxWidth = 'none'
    svgEl.style.display = 'block'
    if (natural) {
      svgEl.setAttribute('width', String(natural.width * scaleRef.current))
      svgEl.setAttribute('height', String(natural.height * scaleRef.current))
    }
    host.replaceChildren(svgEl)
    refit()
  }, [svg, refit])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const observer = new ResizeObserver(() => refit())
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [refit])

  // Cmd/Ctrl＋ホイール（トラックパッドのピンチも含む）で、ポインタの位置を中心に拡大・縮小する。
  // ページ側のスクロール・ズームを止めるため、passive: false で登録する。
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !naturalRef.current) return
      e.preventDefault()
      setMode('manual')
      applyScale(wheelZoom(scaleRef.current, e.deltaY, e.deltaMode), { x: e.clientX, y: e.clientY })
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [applyScale, setMode])

  /** 表示領域の中心。ボタンで拡大率を変えるときに動かさない点。 */
  function viewportCenter(): Anchor | undefined {
    const rect = scrollRef.current?.getBoundingClientRect()
    return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function zoomTo(next: number, anchor = viewportCenter()): void {
    setMode('manual')
    applyScale(next, anchor)
  }

  function fitTo(next: 'fitWidth' | 'fitAll'): void {
    setMode(next)
    refit()
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const scroller = scrollRef.current
    if (e.button !== 0 || !scroller || !canPan) return
    // 文字の選択が始まらないようにする。
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const scroller = scrollRef.current
    const start = dragRef.current
    if (!scroller || !start) return
    scroller.scrollLeft = start.left - (e.clientX - start.x)
    scroller.scrollTop = start.top - (e.clientY - start.y)
  }

  function endDrag(): void {
    dragRef.current = null
    setDragging(false)
  }

  /** ダブルクリックで「合わせる ⇔ 等倍」を切り替える。等倍にするときはポインタの位置を中心にする。 */
  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!naturalRef.current) return
    if (modeRef.current === 'manual') fitTo('fitWidth')
    else zoomTo(1, { x: e.clientX, y: e.clientY })
  }

  const ready = svg !== null && error === null

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        {error && (
          <div style={{ padding: PADDING }}>
            <MermaidError error={error} code={code} />
          </div>
        )}
        {!svg && !error && (
          <p className="text-sm text-muted-foreground" style={{ padding: PADDING }}>
            {t('common.loading')}
          </p>
        )}
        <div
          className={cn(
            'flex min-h-full w-max min-w-full items-start justify-center',
            !ready && 'hidden',
            canPan && (dragging ? 'cursor-grabbing' : 'cursor-grab')
          )}
          style={{ padding: PADDING }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onDoubleClick}
        >
          <div ref={hostRef} />
        </div>
      </div>
      {ready && (
        <div className="absolute right-5 top-2 flex items-center gap-0.5 rounded-md border border-border bg-background/90 p-0.5 shadow-xs">
          <ToolButton title={t('mermaid.zoomOut')} onClick={() => zoomTo(stepZoom(scaleRef.current, -1))}>
            <ZoomOut size={14} />
          </ToolButton>
          <button
            className="h-6 min-w-12 rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('mermaid.actualSize')}
            aria-label={t('mermaid.actualSize')}
            onClick={() => zoomTo(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <ToolButton title={t('mermaid.zoomIn')} onClick={() => zoomTo(stepZoom(scaleRef.current, 1))}>
            <ZoomIn size={14} />
          </ToolButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <ToolButton title={t('mermaid.fitWidth')} active={mode === 'fitWidth'} onClick={() => fitTo('fitWidth')}>
            <MoveHorizontal size={14} />
          </ToolButton>
          <ToolButton title={t('mermaid.fitAll')} active={mode === 'fitAll'} onClick={() => fitTo('fitAll')}>
            <Scan size={14} />
          </ToolButton>
        </div>
      )}
    </div>
  )
}

function ToolButton({
  title,
  active,
  onClick,
  children
}: {
  title: string
  /** 切り替えボタンのときだけ渡す（押されているか）。 */
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
        active && 'bg-accent text-foreground'
      )}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
