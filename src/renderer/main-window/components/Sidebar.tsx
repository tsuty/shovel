import { useEffect, useState } from 'react'
import { FolderTree, MessageSquare, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HistoryEntry, LocalRecordSummary } from '@shared/types/session'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'
import { Filer } from './Filer'
import { ChatHistoryPanel } from './ChatHistoryPanel'
import { ResizablePanel } from './ResizablePanel'

export type SidebarPanel = 'tabs' | 'filer'

const PANEL_ORDER: SidebarPanel[] = ['tabs', 'filer']
const DEFAULT_PANEL_WIDTH = 224

/**
 * サイドバー。メニューバー（アイコンのみ）と、開いているサイドコンテンツを固定順
 * （チャット履歴→ファイラー）で左から並べる。コマンド実行ドロワーはトグルボタンだけを持つ。
 */
export function Sidebar({
  projectId,
  openPanels,
  onTogglePanel,
  commandsOpen,
  onToggleCommands,
  tabs,
  activeSessionId,
  onSelectTab,
  onOpenFile,
  onOpenHistory,
  onOpenLocalRecord,
  onRenameTab,
  onCloseTab,
  onAddToContext,
  onAttachFile,
  canAttachFile
}: {
  projectId: string
  openPanels: Set<SidebarPanel>
  onTogglePanel: (panel: SidebarPanel) => void
  commandsOpen: boolean
  onToggleCommands: () => void
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenFile: (relPath: string) => void
  onOpenHistory: (entry: HistoryEntry) => void
  onOpenLocalRecord: (record: LocalRecordSummary) => void
  onRenameTab: (sessionId: string, title: string) => void
  onCloseTab: (sessionId: string) => void
  onAddToContext: (relPath: string) => void
  onAttachFile: (relPath: string) => void
  canAttachFile: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [widths, setWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    void window.shovel.sidebar.getWidths().then(setWidths)
  }, [])

  function setWidth(panel: SidebarPanel, width: number): void {
    setWidths((prev) => ({ ...prev, [panel]: width }))
    void window.shovel.sidebar.setWidth(panel, width)
  }

  return (
    <div className="flex h-full shrink-0">
      <div className="flex w-11 flex-col items-center gap-1 border-r border-border py-2">
        <IconButton
          active={openPanels.has('tabs')}
          onClick={() => onTogglePanel('tabs')}
          title={t('sidebar.tabs')}
        >
          <MessageSquare size={18} />
        </IconButton>
        <IconButton
          active={openPanels.has('filer')}
          onClick={() => onTogglePanel('filer')}
          title={t('sidebar.filer')}
        >
          <FolderTree size={18} />
        </IconButton>
        <div className="flex-1" />
        <IconButton active={commandsOpen} onClick={onToggleCommands} title={t('sidebar.commands')}>
          <SquareTerminal size={18} />
        </IconButton>
      </div>
      {PANEL_ORDER.filter((p) => openPanels.has(p)).map((panel) => (
        <ResizablePanel
          key={panel}
          width={widths[panel] ?? DEFAULT_PANEL_WIDTH}
          onResizeEnd={(width) => setWidth(panel, width)}
        >
          {panel === 'tabs' && (
            <ChatHistoryPanel
              projectId={projectId}
              tabs={tabs}
              activeSessionId={activeSessionId}
              onSelectTab={onSelectTab}
              onOpenHistory={onOpenHistory}
              onOpenLocalRecord={onOpenLocalRecord}
              onRenameTab={onRenameTab}
              onCloseTab={onCloseTab}
            />
          )}
          {panel === 'filer' && (
            <Filer
              projectId={projectId}
              onOpenFile={onOpenFile}
              onAddToContext={onAddToContext}
              onAttachFile={onAttachFile}
              canAttachFile={canAttachFile}
            />
          )}
        </ResizablePanel>
      ))}
    </div>
  )
}

function IconButton({
  children,
  active,
  disabled,
  title,
  onClick
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  title: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30',
        active && 'bg-accent text-foreground'
      )}
    >
      {children}
    </button>
  )
}
