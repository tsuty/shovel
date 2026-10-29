import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '../../shared/lib/utils'

const DEFAULT_MIN_WIDTH = 160
const DEFAULT_MAX_WIDTH = 480

/**
 * 右端のドラッグで幅を変えられるパネル。確定した幅だけを `onResizeEnd` で親へ渡す。
 *
 * `edge: 'left'` は左端を、`edge: 'top'` は上端をつかんでリサイズする
 * （`top` のときの `width` / `minWidth` / `maxWidth` は高さ）。
 */
export function ResizablePanel({
  width,
  onResizeEnd,
  children,
  edge = 'right',
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  shrinkable = false
}: {
  /** 隣の要素に最小幅があり場所が足りないとき、`minWidth` まで縮んでよい。 */
  shrinkable?: boolean
  width: number
  onResizeEnd: (width: number) => void
  children: React.ReactNode
  edge?: 'left' | 'right' | 'top'
  minWidth?: number
  maxWidth?: number
}): React.JSX.Element {
  const [liveWidth, setLiveWidth] = useState(width)
  const draggingRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 後から届いた保存値を反映する（ドラッグ中は無視する）。
  useEffect(() => {
    if (!draggingRef.current) setLiveWidth(width)
  }, [width])

  function startDrag(e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    // iframe の上を通ってもイベントを受け続ける。
    e.currentTarget.setPointerCapture(e.pointerId)
    const vertical = edge === 'top'
    /** 実際に描かれている幅（`top` のときは高さ）。隣の要素の最小幅に押されて `liveWidth` より狭いことがある。 */
    const renderedWidth = (): number => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return Infinity
      return Math.round(vertical ? rect.height : rect.width)
    }
    const start = vertical ? e.clientY : e.clientX
    const startWidth = Math.min(liveWidth, renderedWidth())
    draggingRef.current = true

    const widthAt = (ev: PointerEvent): number => {
      const pos = vertical ? ev.clientY : ev.clientX
      const delta = edge === 'right' ? pos - start : start - pos
      return Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
    }
    /** 幅を当てたうえで、実際に描けた幅に揃えて返す。 */
    function applyWidth(ev: PointerEvent): number {
      const next = widthAt(ev)
      flushSync(() => setLiveWidth(next))
      const actual = Math.max(minWidth, Math.min(next, renderedWidth()))
      if (actual !== next) setLiveWidth(actual)
      return actual
    }
    function onMove(moveEvent: PointerEvent): void {
      applyWidth(moveEvent)
    }
    function onUp(upEvent: PointerEvent): void {
      draggingRef.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      onResizeEnd(applyWidth(upEvent))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (edge === 'top') {
    return (
      <div ref={rootRef} className="relative flex shrink-0 flex-col" style={{ height: liveWidth }}>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <div className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize" onPointerDown={startDrag} />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex border-border',
        shrinkable ? 'shrink' : 'shrink-0',
        edge === 'right' ? 'border-r' : 'border-l'
      )}
      style={{ width: liveWidth, minWidth: shrinkable ? minWidth : undefined }}
    >
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      <div
        className={cn('absolute top-0 z-10 h-full w-2 cursor-col-resize', edge === 'right' ? '-right-1' : '-left-1')}
        onPointerDown={startDrag}
      />
    </div>
  )
}
