import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { isRestoreUnsupportedMessage } from '@shared/restoreMarker'
import { snapshotEntriesToEvents } from '@shared/snapshotEvents'
import { Button } from '../../shared/components/ui/button'
import { friendlyErrorMessage } from '../../shared/friendlyError'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { Transcript } from './Transcript'

export type ReadOnlyKind = 'backup' | 'deleted'

/**
 * 過去セッションのスナップショットを表示する。
 *
 * `readOnlyKind` を渡すと、バックアップ（decisions.md C-4）／削除済み
 * （C-5）の記録を開く Read Only タブになる: 「再開」「新規開始」を両方隠し、
 * 上部バーの文言を `Backup · {日時}` / `Deleted · {日時}` に切り替える。
 * 中身を今のライブセッションへ書き戻す操作は提供しない。
 *
 * decisions.md C-1/C-2 の復元戦略表:
 * エージェントが `session/load` か `session/resume` に対応していれば
 * 「再開」で文脈ごと繋ぎ直してライブのタブに変わる。対応していない
 * （あるいはエージェント側の id を持たない古いスナップショットの）ときは
 * ここが読み取り専用のまま残り、文脈が失われていることを明示する。
 */
export function HistoryView({
  snapshot,
  readOnlyKind,
  recordTimestamp,
  agentOnly,
  onResume,
  onStartNew,
  onOpenFile
}: {
  snapshot: SessionSnapshot
  readOnlyKind?: ReadOnlyKind
  /** `readOnlyKind` のとき上部バーに出す日時（退避・削除した時刻）。 */
  recordTimestamp?: number
  /**
   * ローカル記録が無く `session/list` にだけある行（decisions.md C-1/C-2 補遺）。
   * 中身は描けないので説明だけを出し、「再開」で `session/load` のライブ
   * replay を描いてもらう。
   */
  agentOnly?: boolean
  onResume: () => Promise<void>
  onStartNew: () => void
  onOpenFile: (relPath: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // ライブのタブと同じ Transcript で描く（ツールコールや添付も同じ見た目になる）。
  // 選択肢（GFM タスクリスト）の「送信」は読み取り専用では意味が無いので外し、
  // 通常の Markdown のチェックボックスとして見せる。
  const state = useMemo(
    () =>
      snapshotEntriesToEvents(snapshot.entries.map((entry) => ({ ...entry, choices: undefined }))).reduce(
        transcriptReducer,
        initialTranscriptState
      ),
    [snapshot.entries]
  )
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
      {readOnlyKind ? (
        <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t(readOnlyKind === 'backup' ? 'history.backupBar' : 'history.deletedBar', {
            date: new Date(recordTimestamp ?? snapshot.savedAt).toLocaleString(i18n.language)
          })}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>{t(agentOnly ? 'history.agentOnlyNotice' : 'history.readOnlyNotice')}</span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={resuming || !snapshot.acpSessionId} onClick={() => void resume()}>
              {resuming ? t('history.resuming') : t('history.resume')}
            </Button>
            <Button size="sm" variant="outline" onClick={onStartNew}>
              {t('history.startNew')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {snapshot.entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t(agentOnly ? 'history.agentOnlyEmpty' : 'history.empty')}
        </p>
      ) : (
        <Transcript state={state} onPermission={() => {}} onOpenFile={onOpenFile} onSubmitChoices={() => {}} />
      )}
    </div>
  )
}
