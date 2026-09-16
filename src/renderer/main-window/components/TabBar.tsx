import { Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'

export interface TabInfo {
  sessionId: string
  title: string
  /**
   * ui.md §4「背景タブの通知」。`undefined` はセッション以外のタブ
   * （ファイル/履歴）で、通知の対象外。
   */
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
        // ui.md §4: 前面のタブは承認カード自体が見えているので、通知は
        // 「前面にないタブにだけ」出す。
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
              className={cn('truncate', showPulse && 'animate-tab-pulse')}
              onClick={() => onSelect(tab.sessionId)}
            >
              {tab.title}
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
