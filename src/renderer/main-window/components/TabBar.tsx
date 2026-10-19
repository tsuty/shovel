import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bot, Clock3, CopyX, File, FileX, Loader2, Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'
import { MenuItem } from './MenuItem'

export interface TabInfo {
  sessionId: string
  title: string
  kind: 'session' | 'file' | 'history' | 'connecting'
  /**
   * セッションタブがいま書き込んでいるスナップショットの id。↻ で新しい会話を
   * 始めると変わる（タブ id の `sessionId` は変わらない）。
   */
  snapshotId?: string
  /** 背景タブの通知状態。`undefined` はセッション以外のタブ（ファイル/履歴）。 */
  status?: { sending: boolean; hasPendingPermission: boolean }
  /** 接続中タブの接続が失敗した。 */
  failed?: boolean
}

/** 押したまま、この距離（px）を超えて動かしたらドラッグとみなす。 */
const DRAG_THRESHOLD = 5
/** ドラッグ中、タブ列の端からこの幅（px）に入ったら横にスクロールする。 */
const DRAG_SCROLL_EDGE = 32
/** ドラッグ中の横スクロールの速さ（px／フレーム）。 */
const DRAG_SCROLL_STEP = 8

export function TabBar({
  tabs,
  activeSessionId,
  onSelect,
  onClose,
  onCloseFiles,
  onNew,
  onMove,
  canAddTab
}: {
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  /** ファイルのタブをまとめて閉じる（チャット・履歴は残す）。`keepId` のタブだけは残す。 */
  onCloseFiles: (keepId: string | null) => void
  onNew: () => void
  /** タブ `id` を `beforeId` のタブの左（`null` なら一番右）へ動かす。 */
  onMove: (id: string, beforeId: string | null) => void
  canAddTab: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number; tab: TabInfo } | null>(null)
  const fileTabCount = tabs.filter((tab) => tab.kind === 'file').length
  const stripRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /** ドラッグ中のタブと、離したときに入る位置（`beforeId` のタブの左。`null` は一番右）。 */
  const [drag, setDrag] = useState<{ id: string; beforeId: string | null; indicatorLeft: number } | null>(null)
  /** ドラッグを終えた直後のクリックを、タブの切り替えとして扱わないための印。 */
  const suppressClickRef = useRef(false)

  /** タブを押したところからドラッグを見張る。動かさずに離せば通常のクリックになる。 */
  function startDragWatch(e: React.PointerEvent, id: string): void {
    if (e.button !== 0) return
    const strip = stripRef.current
    if (!strip) return
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    let pointerX = startX
    let target: { beforeId: string | null; indicatorLeft: number } | null = null
    let scrollFrame = 0

    // ポインタの位置から、離したときに入る位置と、その目印の位置（タブ列の中の x）を求める。
    const locate = (): { beforeId: string | null; indicatorLeft: number } => {
      const els = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'))
      for (const el of els) {
        const rect = el.getBoundingClientRect()
        if (pointerX < rect.left + rect.width / 2) return { beforeId: el.dataset.tabId!, indicatorLeft: el.offsetLeft - 3 }
      }
      const last = els[els.length - 1]
      return { beforeId: null, indicatorLeft: last ? last.offsetLeft + last.offsetWidth + 1 : 0 }
    }
    const update = (): void => {
      target = locate()
      setDrag({ id, ...target })
    }
    // 端に寄せている間は、ポインタを止めていても横に送り続ける。
    const autoScroll = (): void => {
      const rect = strip.getBoundingClientRect()
      const delta =
        pointerX < rect.left + DRAG_SCROLL_EDGE ? -DRAG_SCROLL_STEP : pointerX > rect.right - DRAG_SCROLL_EDGE ? DRAG_SCROLL_STEP : 0
      if (delta !== 0) {
        strip.scrollLeft += delta
        update()
      }
      scrollFrame = requestAnimationFrame(autoScroll)
    }

    const onPointerMove = (ev: PointerEvent): void => {
      pointerX = ev.clientX
      if (!active) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
        active = true
        scrollFrame = requestAnimationFrame(autoScroll)
      }
      update()
    }
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(scrollFrame)
      if (!active) return
      setDrag(null)
      suppressClickRef.current = true
      setTimeout(() => (suppressClickRef.current = false), 0)
      if (commit && target) onMove(id, target.beforeId)
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !active) return
      ev.preventDefault()
      ev.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  // 右端のタブで開いたメニューが画面外へはみ出さないよう、描画直後に左へ寄せる。
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const left = Math.max(4, Math.min(menu.x, window.innerWidth - el.offsetWidth - 4))
    el.style.left = `${left}px`
  }, [menu])

  // 前面のタブがはみ出していたら、タブ列だけを横にスクロールして見せる（Cmd/Ctrl+数字での切り替えなど）。
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeSessionId ?? '')}"]`)
    if (!strip || !el) return
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth
    }
  }, [activeSessionId, tabs.length])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
      {/*
        タブが多いときはこの列だけを横スクロールにする（スクロールバーは出さず、ホイールの縦回転も横へ送る）。
        ここで受け止めないと、はみ出したタブへのフォーカスで外側の列全体が横にずれる。
      */}
      <div
        ref={stripRef}
        className="relative flex h-full min-w-0 items-center gap-1 overflow-x-auto px-0.5 [scrollbar-width:none]"
        onWheel={(e) => {
          if (e.deltaX === 0 && e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeSessionId
        // 通知は前面にないタブにだけ出す。
        const showPendingBadge = !isActive && tab.status?.hasPendingPermission
        const showPulse = !isActive && tab.status?.sending
        return (
          <div
            key={tab.sessionId}
            data-tab-id={tab.sessionId}
            className={cn(
              'relative flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-t-md border border-transparent px-2 text-xs',
              isActive
                ? 'border-border border-b-background bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent',
              drag?.id === tab.sessionId && 'opacity-50'
            )}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, tab })
            }}
            onPointerDown={(e) => startDragWatch(e, tab.sessionId)}
            onClickCapture={(e) => {
              if (!suppressClickRef.current) return
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {showPendingBadge && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
            <button
              className={cn('flex min-w-0 items-center gap-1.5 truncate', showPulse && 'animate-tab-pulse')}
              onClick={() => onSelect(tab.sessionId)}
            >
              {tab.kind === 'file' && <File size={12} className="shrink-0" />}
              {tab.kind === 'session' && <Bot size={12} className="shrink-0" />}
              {tab.kind === 'history' && <Clock3 size={12} className="shrink-0" />}
              {tab.kind === 'connecting' &&
                (tab.failed ? (
                  <AlertTriangle size={12} className="shrink-0 text-destructive" />
                ) : (
                  <Loader2 size={12} className="shrink-0 animate-spin" />
                ))}
              <span className="truncate" title={tab.title}>
                {tab.title}
              </span>
            </button>
            <button
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.sessionId)
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      {drag && (
        <div
          className="pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-primary"
          style={{ left: drag.indicatorLeft }}
        />
      )}
      </div>
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
        onClick={onNew}
        disabled={!canAddTab}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <>
          {/* メニューの外のクリック（右クリックも）で閉じる。 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            ref={menuRef}
            className="fixed z-50 min-w-40 whitespace-nowrap rounded-md border bg-popover p-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              icon={<X size={14} />}
              onClick={() => {
                onClose(menu.tab.sessionId)
                setMenu(null)
              }}
            >
              {t('tabBar.close')}
            </MenuItem>
            {/* チャット・履歴のタブでは「すべてのファイルを閉じる」と同じになるので出さない。 */}
            {menu.tab.kind === 'file' && (
              <MenuItem
                icon={<FileX size={14} />}
                disabled={fileTabCount <= 1}
                onClick={() => {
                  onCloseFiles(menu.tab.sessionId)
                  setMenu(null)
                }}
              >
                {t('tabBar.closeOtherFiles')}
              </MenuItem>
            )}
            <MenuItem
              icon={<CopyX size={14} />}
              disabled={fileTabCount === 0}
              onClick={() => {
                onCloseFiles(null)
                setMenu(null)
              }}
            >
              {t('tabBar.closeAllFiles')}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}
