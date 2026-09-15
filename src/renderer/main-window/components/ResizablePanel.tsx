import { useEffect, useRef, useState } from 'react'

const MIN_WIDTH = 160
const MAX_WIDTH = 480

/**
 * ui.md §3「既定のサイズはあるが可変。サイズは記憶される」。
 * サイドバーの各サイドコンテンツ（チャット履歴/ファイラー/変更）を包み、
 * 右端のドラッグでリサイズする。確定した幅だけを `onResizeEnd` で親へ渡し、
 * 親側で `window.shovel.sidebar.setWidth` に保存する（ドラッグ中に毎回 IPC を
 * 叩かないよう、確定時のみ通知する）。
 */
export function ResizablePanel({
  width,
  onResizeEnd,
  children
}: {
  width: number
  onResizeEnd: (width: number) => void
  children: React.ReactNode
}): React.JSX.Element {
  const [liveWidth, setLiveWidth] = useState(width)
  const draggingRef = useRef(false)

  // 幅の永続化はロード非同期のため、確定値が後から届いても反映する
  // （ドラッグ中に上書きしないよう、ドラッグ中は無視する）。
  useEffect(() => {
    if (!draggingRef.current) setLiveWidth(width)
  }, [width])

  function startDrag(e: React.PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = liveWidth
    draggingRef.current = true

    function onMove(moveEvent: PointerEvent): void {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (moveEvent.clientX - startX)))
      setLiveWidth(next)
    }
    function onUp(upEvent: PointerEvent): void {
      draggingRef.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (upEvent.clientX - startX)))
      onResizeEnd(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="relative flex shrink-0 border-r border-border" style={{ width: liveWidth }}>
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      <div
        className="absolute -right-1 top-0 h-full w-2 cursor-col-resize"
        onPointerDown={startDrag}
      />
    </div>
  )
}
