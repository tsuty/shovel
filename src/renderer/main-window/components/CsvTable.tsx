import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
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

/**
 * CSV / TSV を表で表示する（読み取り専用）。見出しを押すと昇順 → 降順 → 元の順で並べ替え、
 * 見出しの右端をドラッグすると列の幅を変えられる。行は見えている分だけ描く。
 */
export function CsvTable({ data }: { data: CsvTableData }): React.JSX.Element {
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

  // 行番号の列は、いちばん大きい行番号の桁数に合わせる。
  const lastRowNumber = data.rows.at(-1)?.rowNumber ?? 1
  const rowNumberWidth = `${String(lastRowNumber).length + 3}ch`
  const totalWidth = `calc(${rowNumberWidth} + ${table.getTotalSize()}px)`
  const headerGroup = table.getHeaderGroups()[0]

  return (
    <div ref={scrollRef} className="h-full overflow-auto text-editor">
      <div style={{ width: totalWidth }} className="relative">
        <div ref={headerRef} className="sticky top-0 z-20 flex border-b border-border bg-muted font-medium">
          <div
            className="shrink-0 border-r border-border bg-muted"
            style={{ width: rowNumberWidth }}
          />
          {headerGroup?.headers.map((header) => {
            const sorted = header.column.getIsSorted()
            return (
              <div
                key={header.id}
                className="relative flex shrink-0 items-center border-r border-border"
                style={{ width: header.getSize() }}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left hover:bg-accent"
                  title={header.column.columnDef.header as string}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <span className="truncate">{header.column.columnDef.header as string}</span>
                  {sorted === 'asc' && <ArrowUp size={12} className="shrink-0" />}
                  {sorted === 'desc' && <ArrowDown size={12} className="shrink-0" />}
                </button>
                <div
                  className={cn(
                    'absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40',
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
            return (
              <div
                key={row.id}
                className="absolute left-0 flex w-full border-b border-border/60 hover:bg-accent/40"
                style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
              >
                <div
                  className="shrink-0 border-r border-border bg-muted px-2 py-1 text-right text-muted-foreground tabular-nums"
                  style={{ width: rowNumberWidth }}
                >
                  {row.original.rowNumber}
                </div>
                {row.getAllCells().map((cell) => {
                  const value = cell.getValue<string>()
                  return (
                    <div
                      key={cell.id}
                      className="shrink-0 truncate whitespace-pre border-r border-border/60 px-2 py-1"
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
  )
}
