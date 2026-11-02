import { useEffect, useState } from 'react'
import { FolderTree, Globe, MessageSquare, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HistoryEntry, LocalRecordSummary } from '@shared/types/session'
import type { Bookmark } from '@shared/types/browser'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'
import { Filer } from './Filer'
import type { FileReveal } from '../revealMatch'
import { ChatHistoryPanel } from './ChatHistoryPanel'
import { ResizablePanel } from './ResizablePanel'
import type { ChatTarget } from '@shared/chatDraft'
import { BrowserPanel } from './BrowserPanel'

export type SidebarPanel = 'tabs' | 'filer' | 'browser'

const PANEL_ORDER: SidebarPanel[] = ['tabs', 'filer', 'browser']
const DEFAULT_PANEL_WIDTH = 224

/**
 * サイドバー。メニューバー（アイコンのみ）と、開いているサイドコンテンツを固定順
 * （チャット履歴→ファイラー→ブラウザ）で左から並べる。コマンド実行ドロワーはトグルボタンだけを持つ。
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
  onRecordsDeleted,
  chatTargets,
  onAddToContext,
  bookmarks,
  onNewBrowserTab,
  onOpenBookmark,
  onAddBookmark,
  onEditBookmark,
  onDeleteBookmark
}: {
  projectId: string
  openPanels: Set<SidebarPanel>
  onTogglePanel: (panel: SidebarPanel) => void
  commandsOpen: boolean
  onToggleCommands: () => void
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenFile: (relPath: string, at?: Omit<FileReveal, 'nonce'>) => void
  onOpenHistory: (entry: HistoryEntry) => void
  onOpenLocalRecord: (record: LocalRecordSummary) => void
  onRenameTab: (sessionId: string, title: string) => void
  onCloseTab: (sessionId: string) => void
  onRecordsDeleted: (fileNames: string[]) => void
  chatTargets: ChatTarget[]
  onAddToContext: (relPath: string, targetId: string) => void
  bookmarks: Bookmark[]
  onNewBrowserTab: () => void
  onOpenBookmark: (bookmark: Bookmark) => void
  onAddBookmark: () => void
  onEditBookmark: (bookmark: Bookmark) => void
  onDeleteBookmark: (bookmark: Bookmark) => void
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
        <IconButton
          active={openPanels.has('browser')}
          onClick={() => onTogglePanel('browser')}
          title={t('sidebar.browser')}
        >
          <Globe size={18} />
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
              onRecordsDeleted={onRecordsDeleted}
            />
          )}
          {panel === 'filer' && (
            <Filer
              projectId={projectId}
              onOpenFile={onOpenFile}
              chatTargets={chatTargets}
              onAddToContext={onAddToContext}
            />
          )}
          {panel === 'browser' && (
            <BrowserPanel
              bookmarks={bookmarks}
              onNewTab={onNewBrowserTab}
              onOpenBookmark={onOpenBookmark}
              onAddBookmark={onAddBookmark}
              onEditBookmark={onEditBookmark}
              onDeleteBookmark={onDeleteBookmark}
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
