import { Bot, Clock3, File, Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'

export interface TabInfo {
  sessionId: string
  title: string
  kind: 'session' | 'file' | 'history'
  /**
   * セッションタブがいま書き込んでいるスナップショットの id。↻ で新しい会話を
   * 始めると変わる（タブ id の `sessionId` は変わらない）。
   */
  snapshotId?: string
  /** 背景タブの通知状態。`undefined` はセッション以外のタブ（ファイル/履歴）。 */
  status?: { sending: boolean; hasPendingPermission: boolean }
}

export function TabBar({
  tabs,
  activeSessionId,
  onSelect,
  onClose,
  onNew,
  canAddTab
}: {
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
  canAddTab: boolean
}): React.JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeSessionId
        // 通知は前面にないタブにだけ出す。
        const showPendingBadge = !isActive && tab.status?.hasPendingPermission
        const showPulse = !isActive && tab.status?.sending
        return (
          <div
            key={tab.sessionId}
            className={cn(
              'relative flex h-7 max-w-[10rem] items-center gap-1.5 rounded-t-md border border-transparent px-2 text-xs',
              isActive
                ? 'border-border border-b-background bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {showPendingBadge && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
            <button
              className={cn('flex min-w-0 items-center gap-1.5 truncate', showPulse && 'animate-tab-pulse')}
              onClick={() => onSelect(tab.sessionId)}
            >
              {tab.kind === 'file' && <File size={12} className="shrink-0" />}
              {tab.kind === 'session' && <Bot size={12} className="shrink-0" />}
              {tab.kind === 'history' && <Clock3 size={12} className="shrink-0" />}
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.sessionId)
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
        onClick={onNew}
        disabled={!canAddTab}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
