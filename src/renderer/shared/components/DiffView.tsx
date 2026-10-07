import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { collapseContext, diffRowsFromTexts, toSplitRows, withInlineChanges, type DiffRow } from '@shared/diff'
import type { DiffLayout } from '@shared/types/settings'
import { cn } from '../lib/utils'

/**
 * Diff ビューア。ツールコールの前後全文（`TextDiffView`）を `DiffRow` の列に畳み、unified（1列）か
 * split（左右2列、Side by Side）で描く。対になる削除行・追加行は単語単位の変更部分を濃く塗る。
 */

// Tailwind が拾えるよう、完全なクラス名で持つ。
const ROW_CLASS: Record<DiffRow['kind'], string> = {
  context: '',
  add: 'bg-green-500/10',
  remove: 'bg-red-500/10',
  gap: 'bg-muted/60'
}
const TEXT_CLASS: Record<DiffRow['kind'], string> = {
  context: 'text-foreground/80',
  add: 'text-green-700 dark:text-green-400',
  remove: 'text-red-700 dark:text-red-400',
  gap: 'text-muted-foreground'
}
/** 行内で変更された部分。 */
const SPAN_CLASS: Partial<Record<DiffRow['kind'], string>> = {
  add: 'rounded-sm bg-green-500/30',
  remove: 'rounded-sm bg-red-500/30'
}
const MARK: Record<DiffRow['kind'], string> = { context: ' ', add: '+', remove: '-', gap: '' }
const LINE_NO_CLASS = 'shrink-0 select-none px-1 text-right text-muted-foreground/60'

/** 行の本文。行内の差分があれば、変更部分だけ濃く塗る。 */
function RowText({ row }: { row: DiffRow }): React.JSX.Element {
  const { t } = useTranslation()
  if (row.kind === 'gap' && !row.text) return <>{t('diff.hiddenLines', { count: row.count ?? 0 })}</>
  if (!row.spans) return <>{row.text}</>
  return (
    <>
      {row.spans.map((span, index) => (
        <span key={index} className={span.changed ? SPAN_CLASS[row.kind] : undefined}>
          {span.text}
        </span>
      ))}
    </>
  )
}

export function DiffView({
  rows,
  layout = 'unified',
  className
}: {
  rows: DiffRow[]
  layout?: DiffLayout
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return <p className={cn('p-2 text-xs text-muted-foreground', className)}>{t('diff.empty')}</p>
  }
  if (layout === 'split') return <SplitDiffView rows={rows} className={className} />

  return (
    <div className={cn('overflow-auto font-mono text-editor-sm', className)}>
      <div className="min-w-max">
        {rows.map((row, index) => (
          <div key={index} className={cn('flex', ROW_CLASS[row.kind])}>
            <span className={cn('w-[3.4em]', LINE_NO_CLASS)}>{row.oldNo ?? ''}</span>
            <span className={cn('w-[3.4em]', LINE_NO_CLASS)}>{row.newNo ?? ''}</span>
            <span className={cn('w-[1em] shrink-0 select-none text-center', TEXT_CLASS[row.kind])}>
              {MARK[row.kind]}
            </span>
            <span className={cn('whitespace-pre pr-3', TEXT_CLASS[row.kind])}>
              <RowText row={row} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 左右2列。長い行は折り返す（左右の行の高さは1つのグリッド行として揃う）ので、横スクロールは無い。
 * 文脈行は左右に同じ行を出し、変更のかたまりでは相手の無い側を淡色の空欄にする。
 */
function SplitDiffView({ rows, className }: { rows: DiffRow[]; className?: string }): React.JSX.Element {
  const splitRows = useMemo(() => toSplitRows(rows), [rows])
  return (
    <div className={cn('overflow-y-auto font-mono text-editor-sm', className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {splitRows.map((splitRow, index) =>
          splitRow.kind === 'gap' ? (
            <div key={index} className={cn('col-span-4 px-2', ROW_CLASS.gap, TEXT_CLASS.gap)}>
              <RowText row={splitRow.row} />
            </div>
          ) : (
            <Fragment key={index}>
              <SplitCells row={splitRow.left} lineNo={splitRow.left?.oldNo} />
              <SplitCells row={splitRow.right} lineNo={splitRow.right?.newNo} className="border-l border-border" />
            </Fragment>
          )
        )}
      </div>
    </div>
  )
}

/** 片側の「行番号 + 本文」の2セル。 */
function SplitCells({
  row,
  lineNo,
  className
}: {
  row: DiffRow | null
  lineNo: number | undefined
  className?: string
}): React.JSX.Element {
  if (!row) {
    return (
      <>
        <span className={cn('min-w-[3.4em] bg-muted/40', className)} />
        <span className="bg-muted/40" />
      </>
    )
  }
  return (
    <>
      <span className={cn('min-w-[3.4em]', LINE_NO_CLASS, ROW_CLASS[row.kind], className)}>{lineNo ?? ''}</span>
      <span
        className={cn(
          'whitespace-pre-wrap pl-1 pr-3 [overflow-wrap:anywhere]',
          ROW_CLASS[row.kind],
          TEXT_CLASS[row.kind]
        )}
      >
        <RowText row={row} />
      </span>
    </>
  )
}

/** ツールコールの `diffs`（変更前後の全文）を描く。 */
export function TextDiffView({
  oldText,
  newText,
  layout,
  className
}: {
  oldText: string
  newText: string
  layout?: DiffLayout
  className?: string
}): React.JSX.Element {
  const rows = useMemo(
    () => withInlineChanges(collapseContext(diffRowsFromTexts(oldText, newText))),
    [oldText, newText]
  )
  return <DiffView rows={rows} layout={layout} className={className} />
}
