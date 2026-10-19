import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoveHorizontal, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../lib/utils'
import { fitZoom, stepZoom, wheelZoom, type Size, type ZoomMode } from '../lib/zoom'

/** 中身の周りの余白（px）。 */
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
 * 図・画像を、拡大・縮小・等倍・幅に合わせる・全体を表示の操作つきで見せる。親の高さいっぱいに広がり、
 * 自分でスクロールする。`children` は「本来の寸法 × 拡大率」の箱いっぱいに描く（幅・高さ 100%）。
 *
 * - `natural`: 中身の本来の寸法。null の間は箱を隠して `placeholder` を出す（読み込み中・エラー）。
 *   null になっても拡大率とモードは保つので、描き直し・読み直しをまたいで表示が保たれる。
 * - `initialMode`: 最初の拡大率の決め方。ダブルクリックで等倍から戻るときもこのモードにする。
 */
export function ZoomableView({
  natural,
  initialMode,
  placeholder,
  className,
  children
}: {
  natural: Size | null
  initialMode: 'fitWidth' | 'fitAll'
  placeholder?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const naturalRef = useRef<Size | null>(null)
  const modeRef = useRef<ZoomMode>(initialMode)
  const scaleRef = useRef(1)
  const dragRef = useRef<DragStart | null>(null)
  const [mode, setModeState] = useState<ZoomMode>(initialMode)
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

  /** 箱の寸法を `next` 倍にする。`anchor` を渡すと、その点の下にある中身の位置を動かさない。 */
  const applyScale = useCallback(
    (next: number, anchor?: Anchor) => {
      const box = boxRef.current
      const size = naturalRef.current
      const scroller = scrollRef.current
      if (!box || !size || !scroller) return
      let fx = 0.5
      let fy = 0.5
      if (anchor) {
        const before = box.getBoundingClientRect()
        if (before.width > 0) fx = (anchor.x - before.left) / before.width
        if (before.height > 0) fy = (anchor.y - before.top) / before.height
      }
      box.style.width = `${size.width * next}px`
      box.style.height = `${size.height * next}px`
      if (anchor) {
        const after = box.getBoundingClientRect()
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
    const size = naturalRef.current
    const current = modeRef.current
    if (!scroller || !size) return
    if (current === 'manual') {
      updateCanPan()
      return
    }
    const area = { width: scroller.clientWidth - PADDING * 2, height: scroller.clientHeight - PADDING * 2 }
    if (area.width <= 0 || area.height <= 0) return
    applyScale(fitZoom(current, size, area))
  }, [applyScale, updateCanPan])

  // 中身の寸法が変わったら、今の拡大率で箱を作り直してから合わせ直す（スクロール位置が飛ばないように）。
  const naturalWidth = natural?.width
  const naturalHeight = natural?.height
  useLayoutEffect(() => {
    naturalRef.current =
      naturalWidth !== undefined && naturalHeight !== undefined ? { width: naturalWidth, height: naturalHeight } : null
    if (!naturalRef.current) return
    applyScale(scaleRef.current)
    refit()
  }, [naturalWidth, naturalHeight, applyScale, refit])

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
    // 文字の選択・画像のドラッグが始まらないようにする。
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
    if (modeRef.current === 'manual') fitTo(initialMode)
    else zoomTo(1, { x: e.clientX, y: e.clientY })
  }

  const ready = natural !== null

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        {!ready && placeholder && <div style={{ padding: PADDING }}>{placeholder}</div>}
        <div
          className={cn(
            'flex min-h-full w-max min-w-full justify-center',
            initialMode === 'fitAll' ? 'items-center' : 'items-start',
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
          <div ref={boxRef} className="shrink-0">
            {children}
          </div>
        </div>
      </div>
      {ready && (
        <div className="absolute right-5 top-2 flex items-center gap-0.5 rounded-md border border-border bg-background/90 p-0.5 shadow-xs">
          <ToolButton title={t('zoom.zoomOut')} onClick={() => zoomTo(stepZoom(scaleRef.current, -1))}>
            <ZoomOut size={14} />
          </ToolButton>
          <button
            className="h-6 min-w-12 rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('zoom.actualSize')}
            aria-label={t('zoom.actualSize')}
            onClick={() => zoomTo(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <ToolButton title={t('zoom.zoomIn')} onClick={() => zoomTo(stepZoom(scaleRef.current, 1))}>
            <ZoomIn size={14} />
          </ToolButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <ToolButton title={t('zoom.fitWidth')} active={mode === 'fitWidth'} onClick={() => fitTo('fitWidth')}>
            <MoveHorizontal size={14} />
          </ToolButton>
          <ToolButton title={t('zoom.fitAll')} active={mode === 'fitAll'} onClick={() => fitTo('fitAll')}>
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
