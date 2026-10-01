import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LocalRecordSummary, LocalSearchResult } from '@shared/types/session'
import { Dialog, DialogContent, DialogTitle } from '../../shared/components/ui/dialog'

const DEBOUNCE_MS = 200

/** 月日だけ（年内）、年をまたぐものは年も付ける。decisions.md C-6「右寄せの日付」。 */
export function formatShortDate(timestamp: number, locale: string): string {
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}

/**
 * decisions.md C-6 / ui.md「チャット履歴パネル」: ローカルセッション検索。
 * このプロジェクトの全ローカル記録（現行・バックアップ、指定すれば削除済みも）
 * を、Markdown 記法を落とした平文で検索する。約200msデバウンスし、新しい
 * クエリが来たら前の検索は捨てる（main 側でも打ち切る）。
 *
 * 結果行はタイトル＋マッチ箇所を含む一文（マッチ語だけ太字）＋右寄せの日付。
 * プレビュー欄は持たない。バックアップ／削除済みの行だけ、日付を
 * 「バックアップ・{日付}」「削除済み・{日付}」に置き換える。
 */
export function LocalSearchDialog({
  projectId,
  open,
  onOpenChange,
  onOpenRecord
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRecord: (record: LocalRecordSummary) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [results, setResults] = useState<LocalSearchResult[] | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const request = ++requestRef.current
    if (!open || !query.trim()) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      void window.shovel.session.searchLocal(projectId, query, includeDeleted).then((found) => {
        if (found === null || request !== requestRef.current) return
        setResults(found)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [projectId, query, includeDeleted, open])

  function dateLabel(record: LocalRecordSummary): string {
    const date = formatShortDate(record.timestamp, i18n.language)
    if (record.kind === 'backup') return t('search.backupDate', { date })
    if (record.kind === 'deleted') return t('search.deletedDate', { date })
    return date
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-3 p-4">
        <DialogTitle className="text-sm font-medium">{t('search.title')}</DialogTitle>
        <div className="flex items-center gap-2 rounded-md border border-input px-2">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            className="h-8 flex-1 bg-transparent text-sm outline-none"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={t('search.clear')}
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
          {t('search.includeDeleted')}
        </label>
        {results !== null && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('search.results')}</div>
            {results.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t('search.noResults')}</p>
            ) : (
              <ul className="flex flex-col">
                {results.map((result) => (
                  <li key={result.record.fileName}>
                    <button
                      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => {
                        onOpenRecord(result.record)
                        onOpenChange(false)
                      }}
                    >
                      <div className="flex w-full items-baseline gap-2">
                        <span className="flex-1 truncate text-sm font-semibold">
                          {result.record.title || t('history.untitled')}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{dateLabel(result.record)}</span>
                      </div>
                      {result.snippet && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {result.snippet.before}
                          <strong className="font-semibold text-foreground">{result.snippet.match}</strong>
                          {result.snippet.after}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
