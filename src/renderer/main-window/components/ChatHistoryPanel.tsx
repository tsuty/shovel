import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'

interface ContextMenuState {
  x: number
  y: number
  kind: 'tab' | 'history'
  sessionId: string
  currentTitle: string
}

/**
 * ui.md §3 サイドバー「チャット履歴」。開いているタブ（真実はエージェント側に
 * 接続中）と、過去に保存したスナップショット（このアプリ外で終了した
 * セッションも含む、ローカルキャッシュ）を並べる。data-model.md §3。
 * flows.md §6: 右クリックで名前変更・削除ができる
 * （ACP に session/rename が無いため、名前はローカルの上書きとして持つ）。
 *
 * 過去セッションをクリックすると、まずスナップショットを読み取り専用で
 * 表示する（`HistoryView`）。そこから「再開」を選ぶと
 * `session/load` / `session/resume` で文脈ごと繋ぎ直してライブのタブに
 * 変わる（decisions.md C-1/C-2 の復元戦略表）。エージェントがどちらにも
 * 対応していない場合は読み取り専用のまま、文脈が失われていることを
 * 明示する — 引き継げないことを隠さない設計にしている。
 */
export function ChatHistoryPanel({
  projectId,
  tabs,
  activeSessionId,
  onSelectTab,
  onOpenHistory,
  onRenameTab,
  onCloseTab
}: {
  projectId: string
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenHistory: (snapshot: SessionSnapshot) => void
  onRenameTab: (sessionId: string, title: string) => void
  onCloseTab: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [history, setHistory] = useState<SessionSnapshot[]>([])
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refreshHistory = (): void => {
    void window.shovel.session.listHistory(projectId).then(setHistory)
  }

  useEffect(() => {
    refreshHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tabs.length])

  const openIds = new Set(tabs.map((tab) => tab.sessionId))
  const pastHistory = history.filter((h) => !openIds.has(h.sessionId))

  function commitRename(sessionId: string): void {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    void window.shovel.session.rename(sessionId, title).then(() => {
      if (openIds.has(sessionId)) onRenameTab(sessionId, title)
      refreshHistory()
    })
  }

  async function deleteHistory(sessionId: string): Promise<void> {
    setMenu(null)
    if (!confirm(t('history.confirmDelete'))) return
    await window.shovel.session.deleteHistory(sessionId)
    refreshHistory()
  }

  return (
    <div className="flex h-full flex-col p-2" onClick={() => setMenu(null)}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{t('sidebar.tabs')}</div>
      <ul className="flex flex-col gap-1">
        {tabs.map((tab) => (
          <li key={tab.sessionId}>
            {renamingId === tab.sessionId ? (
              <RenameInput
                value={renameValue}
                onChange={setRenameValue}
                onCommit={() => commitRename(tab.sessionId)}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <button
                className={cn(
                  'w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
                  tab.sessionId === activeSessionId && 'bg-accent'
                )}
                onClick={() => onSelectTab(tab.sessionId)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, kind: 'tab', sessionId: tab.sessionId, currentTitle: tab.title })
                }}
              >
                {tab.title}
              </button>
            )}
          </li>
        ))}
      </ul>

      {pastHistory.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-xs font-medium text-muted-foreground">{t('history.title')}</div>
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {pastHistory.map((snapshot) => (
              <li key={snapshot.sessionId}>
                {renamingId === snapshot.sessionId ? (
                  <RenameInput
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={() => commitRename(snapshot.sessionId)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <button
                    className="w-full truncate rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
                    onClick={() => onOpenHistory(snapshot)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        kind: 'history',
                        sessionId: snapshot.sessionId,
                        currentTitle: snapshot.title
                      })
                    }}
                    title={new Date(snapshot.savedAt).toLocaleString()}
                  >
                    {snapshot.title || t('history.untitled')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-[9rem] rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              setRenamingId(menu.sessionId)
              setRenameValue(menu.currentTitle)
              setMenu(null)
            }}
          >
            {t('common.rename')}
          </button>
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              if (menu.kind === 'tab') {
                onCloseTab(menu.sessionId)
                setMenu(null)
              } else {
                void deleteHistory(menu.sessionId)
              }
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel
}: {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <input
      autoFocus
      className="w-full rounded border border-input bg-transparent px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCommit}
    />
  )
}
