import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'

/**
 * ui.md §3 サイドバー「チャット履歴」。開いているタブ（真実はエージェント側に
 * 接続中）と、過去に保存したスナップショット（このアプリ外で終了した
 * セッションも含む、ローカルキャッシュ）を並べる。data-model.md §3。
 *
 * スコープの簡略化: 過去セッションの `session/resume` / `session/load` に
 * よる文脈再接続はまだ実装していない（ACP SDK の高水準ヘルパーは
 * `session/new` 用の `ActiveSession` しか提供せず、resume/load は自前で
 * 更新ループを組む必要があり実装量が大きいため）。クリックすると
 * スナップショットを読み取り専用で表示するだけに留め、続きは「新しい
 * セッションとして始める」ボタンで別タブを開いてもらう — 文脈が
 * 引き継がれないことを隠さない設計にしている。
 */
export function ChatHistoryPanel({
  projectId,
  tabs,
  activeSessionId,
  onSelectTab,
  onOpenHistory
}: {
  projectId: string
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenHistory: (snapshot: SessionSnapshot) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [history, setHistory] = useState<SessionSnapshot[]>([])

  useEffect(() => {
    void window.shovel.session.listHistory(projectId).then(setHistory)
  }, [projectId, tabs.length])

  const openIds = new Set(tabs.map((tab) => tab.sessionId))
  const pastHistory = history.filter((h) => !openIds.has(h.sessionId))

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{t('sidebar.tabs')}</div>
      <ul className="flex flex-col gap-1">
        {tabs.map((tab) => (
          <li key={tab.sessionId}>
            <button
              className={cn(
                'w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
                tab.sessionId === activeSessionId && 'bg-accent'
              )}
              onClick={() => onSelectTab(tab.sessionId)}
            >
              {tab.title}
            </button>
          </li>
        ))}
      </ul>

      {pastHistory.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-xs font-medium text-muted-foreground">{t('history.title')}</div>
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {pastHistory.map((snapshot) => (
              <li key={snapshot.sessionId}>
                <button
                  className="w-full truncate rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
                  onClick={() => onOpenHistory(snapshot)}
                  title={new Date(snapshot.savedAt).toLocaleString()}
                >
                  {snapshot.title || t('history.untitled')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
