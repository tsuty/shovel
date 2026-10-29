import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReadOnlyRecordKind, SessionSnapshot } from '@shared/types/session'
import type { DiffLayout } from '@shared/types/settings'
import { isRestoreUnsupportedMessage } from '@shared/restoreMarker'
import { snapshotEntriesToEvents } from '@shared/snapshotEvents'
import { Button } from '../../shared/components/ui/button'
import { isAuthRequiredMessage } from '@shared/authMarker'
import { friendlyErrorMessage, needsSbxLogin } from '../../shared/friendlyError'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { Transcript } from './Transcript'

export type ReadOnlyKind = ReadOnlyRecordKind

const BAR_LABEL_KEY: Record<ReadOnlyKind, string> = {
  backup: 'history.backupBar',
  deleted: 'history.deletedBar',
  deletedBackup: 'history.deletedBackupBar'
}

/**
 * 過去セッションのスナップショットを表示する。「再開」でライブのタブに切り替えられる。
 *
 * `readOnlyKind` を渡すと、バックアップ／削除済み／削除したバックアップの記録を開く Read Only タブになる。
 * 「再開」「新規開始」を隠し、上部バーの文言を種別に応じて切り替える。
 */
export function HistoryView({
  snapshot,
  readOnlyKind,
  recordTimestamp,
  agentOnly,
  onResume,
  onAuthRequired,
  onStartNew,
  onOpenFile,
  diffLayout
}: {
  snapshot: SessionSnapshot
  readOnlyKind?: ReadOnlyKind
  /** `readOnlyKind` のとき上部バーに出す日時（退避・削除した時刻。削除したバックアップは退避した時刻）。 */
  recordTimestamp?: number
  /** ローカル記録が無く `session/list` にだけある行。中身の代わりに説明を出す。 */
  agentOnly?: boolean
  onResume: () => Promise<void>
  /** 再開の前の確認で未ログインと分かったとき。認証画面でログインを確かめられたら `retry` を呼ぶ。 */
  onAuthRequired: (retry: () => void) => void
  onStartNew: () => void
  onOpenFile: (relPath: string) => void
  diffLayout?: DiffLayout
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // ライブのタブと同じ Transcript で描く。選択肢の「送信」は外し、通常のチェックボックスとして見せる。
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
  const [showSbxLogin, setShowSbxLogin] = useState(false)

  async function resume(): Promise<void> {
    setResuming(true)
    setError(null)
    setShowSbxLogin(false)
    try {
      await onResume()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isAuthRequiredMessage(message)) {
        onAuthRequired(() => void resume())
        return
      }
      setShowSbxLogin(needsSbxLogin(message))
      setError(isRestoreUnsupportedMessage(message) ? t('history.resumeUnsupported') : friendlyErrorMessage(message, t))
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {readOnlyKind ? (
        <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t(BAR_LABEL_KEY[readOnlyKind], {
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
          <div className="whitespace-pre-wrap break-words">{error}</div>
          {showSbxLogin && (
            <button
              className="mt-2 font-medium hover:underline"
              onClick={() => void window.shovel.projects.openSbxLogin()}
            >
              {t('errors.sandboxUnreachable.signIn')}
            </button>
          )}
        </div>
      )}
      {snapshot.entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t(agentOnly ? 'history.agentOnlyEmpty' : 'history.empty')}
        </p>
      ) : (
        <Transcript state={state} onPermission={() => {}} onOpenFile={onOpenFile} onSubmitChoices={() => {}} diffLayout={diffLayout} />
      )}
    </div>
  )
}
