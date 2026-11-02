import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy } from 'lucide-react'
import {
  columnResizingFeature,
  columnSizingFeature,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortFn
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../shared/lib/utils'
import type { CsvRow, CsvTableData } from '../csvTable'
import {
  boundsContain,
  boundsCoverColumn,
  boundsCoverRow,
  clampPos,
  copyPlan,
  dragTo,
  moveBy,
  planToTsv,
  pressAt,
  selectAll,
  selectionBounds,
  type ArrowKey,
  type CellPos,
  type CellRange,
  type CellSelection
} from '../cellSelection'
import { MenuItem } from './MenuItem'

const features = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  sortedRowModel: createSortedRowModel()
})

/** 数字の並びは数として比べ（"9" < "10"）、大文字小文字は区別しない。 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const natural: SortFn<typeof features, CsvRow> = (a, b, columnId) =>
  collator.compare(a.getValue<string>(columnId), b.getValue<string>(columnId))

const defaultColumn = { size: 160, minSize: 48, maxSize: 1200 }

/** 値がこれより長いか改行を含むセルには、ホバーで全文を出す。 */
const TOOLTIP_MIN_LENGTH = 20

/** ドラッグ中にポインタが表の外へ出たとき、1フレームでスクロールする量の上限（px）。 */
const AUTO_SCROLL_MAX = 24

/** 「コピーできません」などの知らせを出しておく時間（ms）。 */
const NOTICE_MS = 2500

const ARROW_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 押した場所（セル・行番号・見出し）の種類と位置。`data-kind` / `data-row` / `data-col` から読む。 */
function targetAt(element: Element | null): { kind: CellRange['kind']; pos: Partial<CellPos> } | null {
  const el = element?.closest<HTMLElement>('[data-kind]')
  if (!el || element?.closest('[data-no-select]')) return null
  const row = el.dataset.row === undefined ? undefined : Number(el.dataset.row)
  const col = el.dataset.col === undefined ? undefined : Number(el.dataset.col)
  return { kind: el.dataset.kind as CellRange['kind'], pos: { row, col } }
}

/**
 * CSV / TSV を表で表示する（読み取り専用）。見出しの ▲▼ を押すと昇順 → 降順 → 元の順で並べ替え、
 * 見出しの右端をドラッグすると列の幅を変えられる。行は見えている分だけ描く。
 * セルの選び方は表計算ソフトと同じ（押す・ドラッグ・Shift・Cmd/Ctrl・矢印キー、行番号・見出しで行・列全体）で、
 * Cmd/Ctrl+C か右クリックの「コピー」で TSV としてクリップボードへ書く。
 */
export function CsvTable({ data }: { data: CsvTableData }): React.JSX.Element {
  const { t } = useTranslation()
  const columns = useMemo<Array<ColumnDef<typeof features, CsvRow>>>(
    () =>
      data.headers.map((header, i) => ({
        id: String(i),
        header,
        accessorFn: (row: CsvRow) => row.cells[i] ?? '',
        sortFn: natural
      })),
    [data.headers]
  )
  const table = useTable({
    features,
    columns,
    data: data.rows,
    defaultColumn,
    columnResizeMode: 'onChange'
  })
  const rows = table.getRowModel().rows
  const headerGroup = table.getHeaderGroups()[0]
  const size = { rows: rows.length, cols: data.headers.length }

  // 選択は表示の順の位置で持つので、中身が替わったとき（外部変更・見出しの切り替え）と並べ替えたときは外す。
  const sortKey = headerGroup?.headers.map((header) => header.column.getIsSorted() || '').join(',') ?? ''
  const [selectionState, setSelectionState] = useState<{
    data: CsvTableData
    sortKey: string
    value: CellSelection
  } | null>(null)
  const selection: CellSelection =
    selectionState?.data === data && selectionState.sortKey === sortKey ? selectionState.value : []
  const keyRef = useRef({ data, sortKey })
  keyRef.current = { data, sortKey }
  /** ドラッグ中のイベントからも最新の選択を元に更新できるよう、関数で受け取る。 */
  function updateSelection(update: (current: CellSelection) => CellSelection): void {
    setSelectionState((prev) => {
      const key = keyRef.current
      const current = prev?.data === key.data && prev.sortKey === key.sortKey ? prev.value : []
      return { ...key, value: update(current) }
    })
  }
  // 範囲は数個なので、描画のたびに求め直す。
  const bounds = selectionBounds(selection, size)
  const active = selection.at(-1)?.anchor

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  // 行はどれも1行で高さが同じなので、見出しの行の高さを測って全行に使う（行ごとには測らない）。
  const headerRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(28)
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    // 文字サイズの設定を変えたときも測り直す。
    const update = (): void => setRowHeight(header.offsetHeight || 28)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 10
  })
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight])

  /** キー操作で動かしたセルが見えるように、表をスクロールする（見出しの行と重ならない位置まで）。 */
  function scrollToCell(pos: CellPos): void {
    const scroller = scrollRef.current
    const header = headerRef.current
    if (!scroller || !header) return
    const headerHeight = header.offsetHeight
    const top = headerHeight + pos.row * rowHeight
    if (top - headerHeight < scroller.scrollTop) scroller.scrollTop = top - headerHeight
    else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + rowHeight - scroller.clientHeight
    }
    const rowNumberPx = (header.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
    const sizes = headerGroup?.headers.map((h) => h.getSize()) ?? []
    const left = rowNumberPx + sizes.slice(0, pos.col).reduce((sum, w) => sum + w, 0)
    const right = left + (sizes[pos.col] ?? 0)
    if (left - rowNumberPx < scroller.scrollLeft) scroller.scrollLeft = left - rowNumberPx
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
  }

  /** ポインタの位置にあるセル・行番号・見出しの位置。表の外なら、表の端に寄せた位置で探す。 */
  function posAtPoint(x: number, y: number): Partial<CellPos> | null {
    const scroller = scrollRef.current
    if (!scroller) return null
    const rect = scroller.getBoundingClientRect()
    const headerHeight = headerRef.current?.offsetHeight ?? 0
    const cx = Math.max(rect.left + 1, Math.min(rect.left + scroller.clientWidth - 2, x))
    const cy = Math.max(rect.top + 1, Math.min(rect.top + scroller.clientHeight - 2, y))
    const hit = targetAt(document.elementFromPoint(cx, cy))
    // 表の上の外（見出しの行）でも、行は見出しのすぐ下の行として扱う。
    if (hit && hit.pos.row === undefined && y < rect.top + headerHeight) {
      const below = targetAt(document.elementFromPoint(cx, rect.top + headerHeight + 1))
      return { col: hit.pos.col, row: below?.pos.row }
    }
    return hit?.pos ?? null
  }

  function startDrag(): void {
    const scroller = scrollRef.current
    if (!scroller) return
    let point: { x: number; y: number } | null = null
    let frame = 0
    const update = (): void => {
      if (!point) return
      const pos = posAtPoint(point.x, point.y)
      if (!pos) return
      updateSelection((current) => {
        const last = current.at(-1)
        if (!last) return current
        return dragTo(current, clampPos({ row: pos.row ?? last.focus.row, col: pos.col ?? last.focus.col }, size))
      })
    }
    // 表の外へ出ている間は、出た距離に応じてスクロールし続ける。
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      if (!point) return
      const rect = scroller.getBoundingClientRect()
      const headerHeight = headerRef.current?.offsetHeight ?? 0
      const dy =
        point.y < rect.top + headerHeight
          ? point.y - (rect.top + headerHeight)
          : point.y > rect.top + scroller.clientHeight
            ? point.y - (rect.top + scroller.clientHeight)
            : 0
      const dx =
        point.x < rect.left ? point.x - rect.left : point.x > rect.left + scroller.clientWidth ? point.x - (rect.left + scroller.clientWidth) : 0
      if (dx === 0 && dy === 0) return
      const step = (d: number): number => Math.sign(d) * Math.min(AUTO_SCROLL_MAX, Math.ceil(Math.abs(d) / 2))
      scroller.scrollTop += step(dy)
      scroller.scrollLeft += step(dx)
      update()
    }
    const onMove = (e: PointerEvent): void => {
      point = { x: e.clientX, y: e.clientY }
      update()
    }
    const onUp = (): void => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    frame = requestAnimationFrame(tick)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    const target = targetAt(e.target as Element)
    if (!target) return
    // 文字の選択を始めさせず、キー操作を受けられるよう表にフォーカスを置く。
    e.preventDefault()
    scrollRef.current?.focus({ preventScroll: true })
    const pos = { row: target.pos.row ?? 0, col: target.pos.col ?? 0 }
    updateSelection((current) => pressAt(current, target.kind, pos, { shift: e.shiftKey, add: e.metaKey || e.ctrlKey }))
    startDrag()
  }

  /** 右クリックした場所が選択の外なら、そこだけを選び直してからメニューを出す。 */
  function handleContextMenu(e: React.MouseEvent): void {
    const target = targetAt(e.target as Element)
    if (!target) return
    e.preventDefault()
    const pos = { row: target.pos.row ?? 0, col: target.pos.col ?? 0 }
    const inside =
      target.kind === 'rows'
        ? boundsCoverRow(bounds, pos.row)
        : target.kind === 'columns'
          ? boundsCoverColumn(bounds, pos.col)
          : boundsContain(bounds, pos.row, pos.col)
    if (!inside) updateSelection(() => pressAt([], target.kind, pos, { shift: false, add: false }))
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const plan = copyPlan(selection, size)

  function copySelection(): void {
    if (selection.length === 0) return
    if (!plan) {
      setNotice(t('editor.tableCannotCopy'))
      return
    }
    void navigator.clipboard.writeText(planToTsv(data, rows.map((row) => row.index), plan))
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (menu) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      copySelection()
    } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      updateSelection(() => selectAll(size))
    } else if (ARROW_KEYS.has(e.key) && !e.altKey) {
      e.preventDefault()
      const next = moveBy(
        selection.length > 0 ? selection : [{ kind: 'cells', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }],
        e.key as ArrowKey,
        { extend: e.shiftKey && selection.length > 0, toEdge: mod },
        size
      )
      updateSelection(() => next)
      const last = next.at(-1)
      if (last) scrollToCell(e.shiftKey ? last.focus : last.anchor)
    } else if (e.key === 'Escape' && selection.length > 0) {
      updateSelection(() => [])
    }
  }

  // 右端で開いたメニューが画面外へはみ出さないよう、描画直後に寄せる。
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - el.offsetWidth - 4))}px`
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - el.offsetHeight - 4))}px`
  }, [menu])

  /** メニューを閉じ、Cmd/Ctrl+C・Esc が続けて効くよう表へフォーカスを戻す（押した項目は消えるため）。 */
  function closeMenu(): void {
    setMenu(null)
    scrollRef.current?.focus({ preventScroll: true })
  }

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

  // 行番号の列は、いちばん大きい行番号の桁数に合わせる。
  const lastRowNumber = data.rows.at(-1)?.rowNumber ?? 1
  const rowNumberWidth = `${String(lastRowNumber).length + 3}ch`
  const totalWidth = `calc(${rowNumberWidth} + ${table.getTotalSize()}px)`

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        tabIndex={0}
        className="h-full select-none overflow-auto text-editor outline-none"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
      >
        <div style={{ width: totalWidth }} className="relative">
          <div ref={headerRef} className="sticky top-0 z-20 flex border-b border-border bg-muted font-medium">
            {/* 幅は ch で決めるので、本文の行番号と同じ字体（太さ）にしておく（違うと列の線がずれる）。 */}
            <div
              className="shrink-0 border-r border-border bg-muted font-normal tabular-nums"
              style={{ width: rowNumberWidth }}
            />
            {headerGroup?.headers.map((header, columnIndex) => {
              const sorted = header.column.getIsSorted()
              const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown
              return (
                <div
                  key={header.id}
                  data-kind="columns"
                  data-col={columnIndex}
                  className={cn(
                    'relative flex shrink-0 cursor-pointer items-center border-r border-border hover:bg-accent',
                    boundsCoverColumn(bounds, columnIndex) && 'bg-primary/20 hover:bg-primary/25'
                  )}
                  style={{ width: header.getSize() }}
                >
                  <span className="min-w-0 flex-1 truncate px-2 py-1" title={header.column.columnDef.header as string}>
                    {header.column.columnDef.header as string}
                  </span>
                  <button
                    data-no-select
                    className={cn(
                      'mr-1.5 shrink-0 rounded-sm p-0.5 hover:bg-background/60',
                      sorted ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'
                    )}
                    title={t('editor.tableSort')}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <SortIcon size={12} />
                  </button>
                  <div
                    data-no-select
                    className={cn(
                      'absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40',
                      header.column.getIsResizing() && 'bg-primary/60'
                    )}
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => header.column.resetSize()}
                  />
                </div>
              )
            })}
          </div>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              if (!row) return null
              const position = item.index
              return (
                <div
                  key={row.id}
                  className="absolute left-0 flex w-full border-b border-border/60 hover:bg-accent/40"
                  style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
                >
                  <div
                    data-kind="rows"
                    data-row={position}
                    className={cn(
                      'shrink-0 cursor-pointer border-r border-border px-2 py-1 text-right tabular-nums',
                      boundsCoverRow(bounds, position)
                        ? 'bg-primary/20 text-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                    )}
                    style={{ width: rowNumberWidth }}
                  >
                    {row.original.rowNumber}
                  </div>
                  {row.getAllCells().map((cell, columnIndex) => {
                    const value = cell.getValue<string>()
                    const isActive = active?.row === position && active.col === columnIndex
                    return (
                      <div
                        key={cell.id}
                        data-kind="cells"
                        data-row={position}
                        data-col={columnIndex}
                        className={cn(
                          'shrink-0 cursor-cell truncate whitespace-pre border-r border-border/60 px-2 py-1',
                          boundsContain(bounds, position, columnIndex) && 'bg-primary/15',
                          isActive && 'outline outline-2 -outline-offset-2 outline-primary'
                        )}
                        style={{ width: cell.column.getSize() }}
                        title={value.length > TOOLTIP_MIN_LENGTH || value.includes('\n') ? value : undefined}
                      >
                        {value.replace(/\r?\n/g, ' ⏎ ')}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {notice && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-md border bg-popover px-3 py-1.5 text-sm shadow-md">
          {notice}
        </div>
      )}
      {menu && selection.length > 0 && (
        <>
          {/* メニューの外のクリック（右クリックも）で閉じる。 */}
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeMenu()
            }}
          />
          <div
            ref={menuRef}
            className="fixed z-50 min-w-40 whitespace-nowrap rounded-md border bg-popover p-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              icon={<Copy size={14} />}
              disabled={!plan}
              onClick={() => {
                copySelection()
                closeMenu()
              }}
            >
              {plan
                ? t('editor.tableCopyCells', { rows: plan.rows.length, columns: plan.columns.length })
                : t('editor.tableCannotCopyShort')}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}
