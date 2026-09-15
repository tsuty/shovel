import { Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'

export interface TabInfo {
  sessionId: string
  title: string
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
      {tabs.map((tab) => (
        <div
          key={tab.sessionId}
          className={cn(
            'flex h-7 max-w-[10rem] items-center gap-1.5 rounded-t-md border border-transparent px-2 text-xs',
            tab.sessionId === activeSessionId
              ? 'border-border border-b-background bg-background text-foreground'
              : 'text-muted-foreground hover:bg-accent'
          )}
        >
          <button className="truncate" onClick={() => onSelect(tab.sessionId)}>
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
      ))}
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
