import { useEffect, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  CloudOff,
  History,
  MessageSquareX,
  Search,
  SquarePen,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HistoryEntry, HistoryListing, LocalRecordSummary } from '@shared/types/session'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'
import { LocalSearchDialog } from './LocalSearchDialog'
import { MenuItem } from './MenuItem'

/** バックアップのサブリストに出す件数。 */
const MAX_VISIBLE_BACKUPS = 20

function formatSize(bytes: number): string {
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
}

function TabKindIcon({ kind }: { kind: TabInfo['kind'] }): React.JSX.Element {
  if (kind === 'history') return <Clock3 size={14} className="shrink-0 text-muted-foreground" />
  return <Bot size={14} className="shrink-0 text-muted-foreground" />
}

interface ContextMenuState {
  x: number
  y: number
  kind: 'tab' | 'history'
  sessionId: string
  currentTitle: string
  /** `kind: 'history'` のときの行。 */
  entry?: HistoryEntry
}

/**
 * 行がローカル／エージェントのどちら側に存在するかをアイコンとツールチップで示す。
 * `unknown` は「両方にある」と同じ見た目にする。
 */
function HistoryStateIcon({ entry, hasBackups }: { entry: HistoryEntry; hasBackups: boolean }): React.JSX.Element {
  if (entry.state === 'agentOnly') return <Cloud size={14} className="shrink-0" />
  if (entry.state === 'localOnly') return <CloudOff size={14} className="shrink-0" />
  if (hasBackups) return <History size={14} className="shrink-0" />
  return <Clock3 size={14} className="shrink-0" />
}

/**
 * サイドバーの「チャット」パネル。開いているタブと過去のセッションを並べる。
 *   - 過去セッションをクリックすると読み取り専用の `HistoryView` で開く。
 *   - 右クリックで名前変更・削除。
 *   - バックアップを持つ行には展開キャレットを付け、`{日時} {サイズ}` のサブリストを出す。
 *   - 「削除済みを表示」トグルで削除済みセクションを出す。
 *   - 見出しの右にローカル検索の入口（🔎）を置く。
 *   - バックアップ／削除済みの行はクリックで Read Only タブとして開く。
 */
export function ChatHistoryPanel({
  projectId,
  tabs,
  activeSessionId,
  onSelectTab,
  onOpenHistory,
  onOpenLocalRecord,
  onRenameTab,
  onCloseTab
}: {
  projectId: string
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenHistory: (entry: HistoryEntry) => void
  onOpenLocalRecord: (record: LocalRecordSummary) => void
  onRenameTab: (sessionId: string, title: string) => void
  onCloseTab: (sessionId: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [history, setHistory] = useState<HistoryListing>({ entries: [], canDeleteAgentSessions: false })
  const [records, setRecords] = useState<LocalRecordSummary[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showDeleted, setShowDeleted] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refreshHistory = (): void => {
    void window.shovel.session.listHistory(projectId).then(setHistory)
    void window.shovel.session.listLocalRecords(projectId).then(setRecords)
  }

  // タブの開閉・snapshotId の変化のたびに一覧を取り直す。
  const openRecordsKey = tabs.map((tab) => tab.snapshotId ?? tab.sessionId).join('\n')
  useEffect(() => {
    refreshHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, openRecordsKey])

  // バックアップが作られたときに一覧を取り直す。
  useEffect(() => {
    return window.shovel.session.onLocalRecordsChanged((changedProjectId) => {
      if (changedProjectId === projectId) refreshHistory()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 開いているタブが書き込んでいるスナップショット（↻ 済みのタブは新しい方）。
  const openIds = new Set(tabs.map((tab) => tab.snapshotId ?? tab.sessionId))
  // 開いているタブの分は一覧から除く。
  const pastHistory = history.entries.filter((h) => !h.snapshotId || !openIds.has(h.snapshotId))
  const backupsBySession = new Map<string, LocalRecordSummary[]>()
  for (const record of records) {
    if (record.kind !== 'backup') continue
    const list = backupsBySession.get(record.sessionId) ?? []
    list.push(record)
    backupsBySession.set(record.sessionId, list)
  }
  const deletedRecords = records.filter((record) => record.kind === 'deleted')

  function toggleExpanded(sessionId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  /** 名前を変える。開いているタブならタブ名も変える。 */
  function commitRename(snapshotId: string, tabId?: string): void {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    void window.shovel.session.rename(projectId, snapshotId, title).then(() => {
      if (tabId) onRenameTab(tabId, title)
      refreshHistory()
    })
  }

  async function deleteHistory(entry: HistoryEntry): Promise<void> {
    setMenu(null)
    // 「エージェントのみ」の行は確認文言を変える。
    if (!confirm(t(entry.snapshotId ? 'history.confirmDelete' : 'history.confirmDeleteAgentOnly'))) return
    await window.shovel.session.deleteHistory(projectId, {
      snapshotId: entry.snapshotId,
      acpSessionId: entry.acpSessionId
    })
    refreshHistory()
  }

  return (
    <div className="flex h-full flex-col p-2" onClick={() => setMenu(null)}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{t('sidebar.tabs')}</div>
      <ul className="flex flex-col gap-1">
        {/* 会話（セッション・履歴）だけを並べる。 */}
        {tabs.filter((tab) => tab.kind !== 'file').map((tab) => (
          <li key={tab.sessionId}>
            {renamingId === tab.sessionId ? (
              <RenameInput
                value={renameValue}
                onChange={setRenameValue}
                onCommit={() => commitRename(tab.snapshotId ?? tab.sessionId, tab.sessionId)}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <button
                className={cn(
                  'flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
                  tab.sessionId === activeSessionId && 'bg-accent'
                )}
                onClick={() => onSelectTab(tab.sessionId)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, kind: 'tab', sessionId: tab.sessionId, currentTitle: tab.title })
                }}
              >
                <TabKindIcon kind={tab.kind} />
                <span className="truncate">{tab.title}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {records.length > 0 && (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{t('history.title')}</span>
            <button
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground"
              title={t('search.open')}
              onClick={(e) => {
                e.stopPropagation()
                setSearchOpen(true)
              }}
            >
              <Search size={13} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {pastHistory.map((entry) => {
                const backups = (entry.snapshotId && backupsBySession.get(entry.snapshotId)) || []
                const isExpanded = expanded.has(entry.key)
                return (
                  <li key={entry.key}>
                    {renamingId === entry.key && entry.snapshotId ? (
                      <RenameInput
                        value={renameValue}
                        onChange={setRenameValue}
                        onCommit={() => commitRename(entry.snapshotId!)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <div className="flex items-center">
                        {backups.length > 0 ? (
                          <button
                            className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                            title={t('history.backups', { count: backups.length })}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpanded(entry.key)
                            }}
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <button
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-1 py-1 text-left text-sm hover:bg-accent',
                            backups.length > 0 ? 'text-foreground/80' : 'text-muted-foreground'
                          )}
                          onClick={() => onOpenHistory(entry)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setMenu({
                              x: e.clientX,
                              y: e.clientY,
                              kind: 'history',
                              sessionId: entry.key,
                              currentTitle: entry.title,
                              entry
                            })
                          }}
                          title={[
                            entry.updatedAt ? new Date(entry.updatedAt).toLocaleString(i18n.language) : '',
                            entry.state === 'localOnly' ? t('history.state.localOnly') : '',
                            entry.state === 'agentOnly' ? t('history.state.agentOnly') : ''
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        >
                          <HistoryStateIcon entry={entry} hasBackups={backups.length > 0} />
                          <span className="truncate">{entry.title || t('history.untitled')}</span>
                        </button>
                      </div>
                    )}
                    {isExpanded && backups.length > 0 && (
                      <ul className="ml-5 mt-0.5 flex flex-col border-l border-border pl-2">
                        {backups.slice(0, MAX_VISIBLE_BACKUPS).map((backup) => (
                          <li key={backup.fileName}>
                            <button
                              className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-accent"
                              onClick={() => onOpenLocalRecord(backup)}
                            >
                              <span className="truncate">{new Date(backup.timestamp).toLocaleString(i18n.language)}</span>
                              <span className="shrink-0 tabular-nums">{formatSize(backup.sizeBytes)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>

            {deletedRecords.length > 0 && (
              <label className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                {t('history.showDeleted')}
              </label>
            )}
            {showDeleted && deletedRecords.length > 0 && (
              <>
                <div className="mb-1 mt-2 px-1 text-xs font-medium text-muted-foreground/70">
                  {t('history.deletedSection')}
                </div>
                <ul className="flex flex-col gap-0.5 opacity-60">
                  {deletedRecords.map((record) => (
                    <li key={record.fileName}>
                      <button
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
                        title={new Date(record.timestamp).toLocaleString(i18n.language)}
                        onClick={() => onOpenLocalRecord(record)}
                      >
                        <Trash2 size={13} className="shrink-0" />
                        <span className="flex-1 truncate">{record.title || t('history.untitled')}</span>
                        <span className="shrink-0 text-xs">{new Date(record.timestamp).toLocaleDateString(i18n.language)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      <LocalSearchDialog
        projectId={projectId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenRecord={onOpenLocalRecord}
      />

      {menu && (
        <div
          className="fixed z-50 min-w-[9rem] rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<SquarePen size={14} />}
            // 「エージェントのみ」の行は名前を変えられない。
            disabled={menu.kind === 'history' && !menu.entry?.snapshotId}
            onClick={() => {
              setRenamingId(menu.sessionId)
              setRenameValue(menu.currentTitle)
              setMenu(null)
            }}
          >
            {t('common.rename')}
          </MenuItem>
          {menu.kind === 'tab' ? (
            // 開いているタブの行ではタブを閉じる。
            <MenuItem
              icon={<MessageSquareX size={14} />}
              onClick={() => {
                onCloseTab(menu.sessionId)
                setMenu(null)
              }}
            >
              {t('common.close')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Trash2 size={14} />}
              // 「エージェントのみ」の行は session/delete を送れるときだけ消せる。
              disabled={!menu.entry?.snapshotId && !history.canDeleteAgentSessions}
              onClick={() => {
                if (menu.entry) void deleteHistory(menu.entry)
              }}
            >
              {t('common.delete')}
            </MenuItem>
          )}
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
