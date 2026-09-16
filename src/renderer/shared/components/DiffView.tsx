import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { collapseContext, diffRowsFromTexts, type DiffRow } from '../lib/diff'
import { cn } from '../lib/utils'

/**
 * decisions.md N-3-8 の Diff ビューア。ツールコール単体の前後全文（`TextDiffView`）
 * を `DiffRow` の列に畳んでから描く。
 *
 * 表示は unified（1列）。サイドバーに入る幅でも読めることを優先し、
 * 左右2列の split は採らない。
 */

// Tailwind は文字列連結で組み立てたクラス名を拾えないため、完全な形で持つ。
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
const MARK: Record<DiffRow['kind'], string> = { context: ' ', add: '+', remove: '-', gap: '' }

export function DiffView({ rows, className }: { rows: DiffRow[]; className?: string }): React.JSX.Element {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return <p className={cn('p-2 text-xs text-muted-foreground', className)}>{t('diff.empty')}</p>
  }

  return (
    <div className={cn('overflow-auto font-mono text-xs leading-5', className)}>
      <div className="min-w-max">
        {rows.map((row, index) => (
          <div key={index} className={cn('flex', ROW_CLASS[row.kind])}>
            <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/60">
              {row.oldNo ?? ''}
            </span>
            <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/60">
              {row.newNo ?? ''}
            </span>
            <span className={cn('w-3 shrink-0 select-none text-center', TEXT_CLASS[row.kind])}>
              {MARK[row.kind]}
            </span>
            <span className={cn('whitespace-pre pr-3', TEXT_CLASS[row.kind])}>
              {row.kind === 'gap' && !row.text ? t('diff.hiddenLines', { count: row.count ?? 0 }) : row.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** ツールコールの `diffs`（変更前後の全文）を描く。 */
export function TextDiffView({
  oldText,
  newText,
  className
}: {
  oldText: string
  newText: string
  className?: string
}): React.JSX.Element {
  const rows = useMemo(() => collapseContext(diffRowsFromTexts(oldText, newText)), [oldText, newText])
  return <DiffView rows={rows} className={className} />
}
