import { FolderTree, GitBranch, MessageSquare, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/types/session'
import { cn } from '../../shared/lib/utils'
import type { TabInfo } from './TabBar'
import { Filer } from './Filer'
import { Changes } from './Changes'
import { ChatHistoryPanel } from './ChatHistoryPanel'

export type SidebarPanel = 'tabs' | 'filer' | 'changes'

const PANEL_ORDER: SidebarPanel[] = ['tabs', 'filer', 'changes']

/**
 * ui.md §3「サイドバー」: メニューバー(アイコンのみ) + サイドコンテンツ。
 * 排他ではなく、押した順ではなく固定順（チャット履歴→ファイラー→変更）で
 * 左から並べる（クリックされたものすべてを表示する、という要件の簡易実装）。
 * 下付きの「コマンド実行」はサイドではなく画面下のドロワーなので、ここでは
 * トグルボタンだけを持つ。
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
  onRenameTab,
  onCloseTab
}: {
  projectId: string
  openPanels: Set<SidebarPanel>
  onTogglePanel: (panel: SidebarPanel) => void
  commandsOpen: boolean
  onToggleCommands: () => void
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelectTab: (sessionId: string) => void
  onOpenFile: (relPath: string, isMarkdown: boolean) => void
  onOpenHistory: (snapshot: SessionSnapshot) => void
  onRenameTab: (sessionId: string, title: string) => void
  onCloseTab: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

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
          active={openPanels.has('changes')}
          onClick={() => onTogglePanel('changes')}
          title={t('sidebar.changes')}
        >
          <GitBranch size={18} />
        </IconButton>
        <div className="flex-1" />
        <IconButton active={commandsOpen} onClick={onToggleCommands} title={t('sidebar.commands')}>
          <SquareTerminal size={18} />
        </IconButton>
      </div>
      {PANEL_ORDER.filter((p) => openPanels.has(p)).map((panel) => (
        <div key={panel} className="w-56 shrink-0 border-r border-border">
          {panel === 'tabs' && (
            <ChatHistoryPanel
              projectId={projectId}
              tabs={tabs}
              activeSessionId={activeSessionId}
              onSelectTab={onSelectTab}
              onOpenHistory={onOpenHistory}
              onRenameTab={onRenameTab}
              onCloseTab={onCloseTab}
            />
          )}
          {panel === 'filer' && <Filer projectId={projectId} onOpenFile={onOpenFile} />}
          {panel === 'changes' && <Changes projectId={projectId} />}
        </div>
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
