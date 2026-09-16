import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { isRestoreUnsupportedMessage } from '@shared/restoreMarker'
import { Markdown } from '../../shared/components/Markdown'
import { Button } from '../../shared/components/ui/button'
import { friendlyErrorMessage } from '../../shared/friendlyError'

/**
 * 過去セッションのスナップショットを表示する。
 *
 * decisions.md C-1/C-2 の復元戦略表:
 * エージェントが `session/load` か `session/resume` に対応していれば
 * 「再開」で文脈ごと繋ぎ直してライブのタブに変わる。対応していない
 * （あるいはエージェント側の id を持たない古いスナップショットの）ときは
 * ここが読み取り専用のまま残り、文脈が失われていることを明示する。
 */
export function HistoryView({
  snapshot,
  onResume,
  onStartNew
}: {
  snapshot: SessionSnapshot
  onResume: () => Promise<void>
  onStartNew: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [resuming, setResuming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resume(): Promise<void> {
    setResuming(true)
    setError(null)
    try {
      await onResume()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(isRestoreUnsupportedMessage(message) ? t('history.resumeUnsupported') : friendlyErrorMessage(message, t))
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>{t('history.readOnlyNotice')}</span>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={resuming || !snapshot.acpSessionId} onClick={() => void resume()}>
            {resuming ? t('history.resuming') : t('history.resume')}
          </Button>
          <Button size="sm" variant="outline" onClick={onStartNew}>
            {t('history.startNew')}
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
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
