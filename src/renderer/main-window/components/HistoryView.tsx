import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { Markdown } from '../../shared/components/Markdown'
import { Button } from '../../shared/components/ui/button'

/**
 * 過去セッションのスナップショットを読み取り専用で表示する。
 * ChatHistoryPanel のコメント参照: `session/resume`/`session/load` による
 * 文脈の再接続はまだ実装していないため、続きは新しいセッションとして
 * 始めてもらう（文脈は引き継がれないことを明示する）。
 */
export function HistoryView({
  snapshot,
  onStartNew
}: {
  snapshot: SessionSnapshot
  onStartNew: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>{t('history.readOnlyNotice')}</span>
        <Button size="sm" variant="outline" onClick={onStartNew}>
          {t('history.startNew')}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-3">
          {snapshot.entries.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border px-3 py-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {entry.role === 'USER' ? t('transcript.you') : t('transcript.agent')}
              </div>
              <Markdown text={entry.markdown} />
            </div>
          ))}
          {snapshot.entries.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
