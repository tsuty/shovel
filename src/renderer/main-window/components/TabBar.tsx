import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bot, Clock3, Columns2, CopyX, File, FileX, Globe, Loader2, Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'
import { tabIndicator, type TabStatus } from '../tabAttention'
import { MenuItem } from './MenuItem'

export interface TabInfo {
  sessionId: string
  title: string
  /** タブ名のツールチップ（ファイルのタブはプロジェクト内のパス）。無ければ `title`。 */
  tooltip?: string
  kind: 'session' | 'file' | 'history' | 'connecting' | 'browser'
  /**
   * セッションタブがいま書き込んでいるスナップショットの id。↻ で新しい会話を
   * 始めると変わる（タブ id の `sessionId` は変わらない）。
   */
  snapshotId?: string
  /** チャットの状態。`undefined` はセッション以外のタブ（ファイル/履歴）。 */
  status?: TabStatus
  /** 接続中タブの接続が失敗した。 */
  failed?: boolean
  /** 「右に分割して移動」を押せる。 */
  canSplitRight?: boolean
}

/** ドラッグで離したときに入る位置。`beforeId` のタブの左（`null` はそのペインの右端）。 */
interface DropTarget {
  paneId: string
  beforeId: string | null
  /** 入る位置の目印（画面上の座標）。 */
  indicator: { left: number; top: number; height: number }
}

/** 押したまま、この距離（px）を超えて動かしたらドラッグとみなす。 */
const DRAG_THRESHOLD = 5
/** ドラッグ中、タブ列の端からこの幅（px）に入ったら横にスクロールする。 */
const DRAG_SCROLL_EDGE = 32
/** ドラッグ中の横スクロールの速さ（px／フレーム）。 */
const DRAG_SCROLL_STEP = 8

/**
 * ポインタの x 座標から、離したときに入るペインと位置を求める。ペインはタブバーの横の範囲で決め
 * （範囲外なら近い方の端のペイン）、その中でタブの中央より左ならそのタブの左に入る。
 */
function locateDrop(pointerX: number): { target: DropTarget; strip: HTMLElement } | null {
  const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-bar]'))
  if (bars.length === 0) return null
  const bar =
    bars.find((el) => {
      const rect = el.getBoundingClientRect()
      return pointerX >= rect.left && pointerX <= rect.right
    }) ?? (pointerX < bars[0]!.getBoundingClientRect().left ? bars[0]! : bars[bars.length - 1]!)
  const strip = bar.querySelector<HTMLElement>('[data-pane-strip]')
  if (!strip) return null
  const stripRect = strip.getBoundingClientRect()
  const indicator = (left: number): DropTarget['indicator'] => ({ left, top: stripRect.top + 4, height: stripRect.height - 8 })
  const els = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'))
  const paneId = bar.dataset.paneBar!
  for (const el of els) {
    const rect = el.getBoundingClientRect()
    if (pointerX < rect.left + rect.width / 2) {
      return { target: { paneId, beforeId: el.dataset.tabId!, indicator: indicator(rect.left - 3) }, strip }
    }
  }
  const last = els[els.length - 1]
  const left = last ? last.getBoundingClientRect().right + 1 : stripRect.left + 2
  return { target: { paneId, beforeId: null, indicator: indicator(left) }, strip }
}

/**
 * 分割ビューのペインのタブバー。タブはペインをまたいでドラッグで動かせる。
 * `focused` はこのペインが前面のペインか（ペインが複数のときだけ印を付ける）。
 */
export function TabBar({
  paneId,
  tabs,
  activeId,
  focused,
  showFocus,
  onSelect,
  onClose,
  onCloseFiles,
  onNew,
  onMove,
  onSplitRight,
  canAddTab
}: {
  paneId: string
  tabs: TabInfo[]
  activeId: string | null
  focused: boolean
  showFocus: boolean
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  /** このペインのファイルのタブをまとめて閉じる（チャット・履歴は残す）。`keepId` のタブだけは残す。 */
  onCloseFiles: (keepId: string | null) => void
  /** このペインに新しいチャットを開く。 */
  onNew: () => void
  /** タブ `id` を `toPaneId` のペインの `beforeId` のタブの左（`null` なら右端）へ動かす。 */
  onMove: (id: string, toPaneId: string, beforeId: string | null) => void
  /** このペインを半分に分け、タブを右の新しいペインへ移す。 */
  onSplitRight: (sessionId: string) => void
  canAddTab: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number; tab: TabInfo } | null>(null)
  const fileTabCount = tabs.filter((tab) => tab.kind === 'file').length
  const stripRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /** ドラッグ中のタブと、離したときに入る位置。 */
  const [drag, setDrag] = useState<{ id: string; target: DropTarget | null } | null>(null)
  /** ドラッグを終えた直後のクリックを、タブの切り替えとして扱わないための印。 */
  const suppressClickRef = useRef(false)

  /** タブを押したところからドラッグを見張る。動かさずに離せば通常のクリックになる。 */
  function startDragWatch(e: React.PointerEvent, id: string): void {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    let pointerX = startX
    let target: DropTarget | null = null
    let targetStrip: HTMLElement | null = null
    let scrollFrame = 0

    const update = (): void => {
      const found = locateDrop(pointerX)
      target = found?.target ?? null
      targetStrip = found?.strip ?? null
      setDrag({ id, target })
    }
    // 端に寄せている間は、ポインタを止めていても入る先のタブ列を横に送り続ける。
    const autoScroll = (): void => {
      const strip = targetStrip
      if (strip) {
        const rect = strip.getBoundingClientRect()
        const delta =
          pointerX < rect.left + DRAG_SCROLL_EDGE ? -DRAG_SCROLL_STEP : pointerX > rect.right - DRAG_SCROLL_EDGE ? DRAG_SCROLL_STEP : 0
        const before = strip.scrollLeft
        if (delta !== 0) strip.scrollLeft += delta
        if (strip.scrollLeft !== before) update()
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
      if (commit && target) onMove(id, target.paneId, target.beforeId)
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
    const el = strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId ?? '')}"]`)
    if (!strip || !el) return
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth
    }
  }, [activeId, tabs.length])

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
    <div
      data-pane-bar={paneId}
      className={cn(
        'flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-t-2 border-b-border px-2',
        showFocus && focused ? 'border-t-primary' : 'border-t-transparent'
      )}
    >
      {/*
        タブが多いときはこの列だけを横スクロールにする（スクロールバーは出さず、ホイールの縦回転も横へ送る）。
        ここで受け止めないと、はみ出したタブへのフォーカスで外側の列全体が横にずれる。
      */}
      <div
        ref={stripRef}
        data-pane-strip
        className="relative flex h-full min-w-0 items-center gap-1 overflow-x-auto px-0.5 [scrollbar-width:none]"
        onWheel={(e) => {
          if (e.deltaX === 0 && e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeId
          const indicator = tabIndicator(tab.status, isActive)
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
              {indicator.badge && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
              <button
                className="flex min-w-0 items-center gap-1.5 truncate"
                onClick={() => onSelect(tab.sessionId)}
              >
                {tab.kind === 'file' && <File size={12} className="shrink-0" />}
                {tab.kind === 'session' && (
                  <Bot
                    size={12}
                    className={cn('shrink-0', indicator.spin && 'tab-icon-spin', indicator.blink && 'tab-icon-blink')}
                  />
                )}
                {tab.kind === 'history' && <Clock3 size={12} className="shrink-0" />}
                {tab.kind === 'browser' && <Globe size={12} className="shrink-0" />}
                {tab.kind === 'connecting' &&
                  (tab.failed ? (
                    <AlertTriangle size={12} className="shrink-0 text-destructive" />
                  ) : (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ))}
                <span className="truncate" title={tab.tooltip ?? tab.title}>
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
      </div>
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
        onClick={onNew}
        disabled={!canAddTab}
      >
        <Plus size={14} />
      </button>
      {drag?.target && (
        <div
          className="pointer-events-none fixed z-50 w-0.5 rounded-full bg-primary"
          style={{ left: drag.target.indicator.left, top: drag.target.indicator.top, height: drag.target.indicator.height }}
        />
      )}
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
            <div className="-mx-1 my-1 h-px bg-border" />
            <MenuItem
              icon={<Columns2 size={14} />}
              disabled={!menu.tab.canSplitRight}
              onClick={() => {
                onSplitRight(menu.tab.sessionId)
                setMenu(null)
              }}
            >
              {t('tabBar.splitRight')}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}
