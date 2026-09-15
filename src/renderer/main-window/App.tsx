import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectWithStatus } from '@shared/types/project'
import type { SessionMeta, SessionSnapshot } from '@shared/types/session'
import { Header } from './components/Header'
import { Sidebar, type SidebarPanel } from './components/Sidebar'
import { TabBar, type TabInfo } from './components/TabBar'
import { SessionView } from './components/SessionView'
import { FileViewer } from './components/FileViewer'
import { MarkdownEditor } from './components/MarkdownEditor'
import { Commands } from './components/Commands'
import { HistoryView } from './components/HistoryView'
import { useSettings } from '../shared/useSettings'
import { SettingsDialog } from '../shared/components/SettingsDialog'
import { AuthDialog } from './components/AuthDialog'
import { AUTH_REQUIRED_MARKER } from '@shared/authMarker'
import { useTabSwitchShortcuts } from './useTabShortcuts'

const MAX_SESSION_TABS = 10

type Tab =
  | { kind: 'session'; sessionId: string; title: string; meta: SessionMeta }
  | { kind: 'file'; sessionId: string; title: string; relPath: string; isMarkdown: boolean }
  | { kind: 'history'; sessionId: string; title: string; snapshot: SessionSnapshot }

function getProjectIdFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('projectId')
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [projectId] = useState(getProjectIdFromQuery)
  const [project, setProject] = useState<ProjectWithStatus | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPanels, setOpenPanels] = useState<Set<SidebarPanel>>(new Set(['tabs']))
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const { settings, update: updateSettings } = useSettings()

  useEffect(() => {
    if (!projectId) return
    void window.shovel.projects.list().then((projects) => {
      setProject(projects.find((p) => p.id === projectId) ?? null)
    })
  }, [projectId])

  const sessionTabCount = tabs.filter((tab) => tab.kind === 'session').length

  async function openNewTab(): Promise<void> {
    if (!projectId || sessionTabCount >= MAX_SESSION_TABS) return
    setError(null)

    // flows.md §1-2: 接続前に高速な事前チェックを行い、未ログインなら接続を
    // 試みずに認証画面を出す。
    const status = await window.shovel.auth.status(projectId)
    if (!status.checkFailed && !status.loggedIn) {
      setAuthOpen(true)
      return
    }

    try {
      const { sessionId, meta } = await window.shovel.session.openTab(projectId)
      setTabs((prev) => [
        ...prev,
        { kind: 'session', sessionId, title: `Tab ${sessionTabCount + 1}`, meta }
      ])
      setActiveSessionId(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 事前チェックを素通りしても、トークン期限切れ等で接続時に認証エラーに
      // なることがある。同じ認証画面へ導く（flows.md §1-2「両方持つ」）。
      if (message === AUTH_REQUIRED_MARKER) {
        setAuthOpen(true)
        return
      }
      setError(message)
    }
  }

  useEffect(() => {
    if (projectId && tabs.length === 0) void openNewTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  function openFile(relPath: string, isMarkdown: boolean): void {
    const existing = tabs.find((tab) => tab.kind === 'file' && tab.relPath === relPath)
    if (existing) {
      setActiveSessionId(existing.sessionId)
      return
    }
    const id = `file:${relPath}`
    setTabs((prev) => [
      ...prev,
      { kind: 'file', sessionId: id, title: relPath.split('/').pop() ?? relPath, relPath, isMarkdown }
    ])
    setActiveSessionId(id)
  }

  function openHistory(snapshot: SessionSnapshot): void {
    const id = `history:${snapshot.sessionId}`
    const existing = tabs.find((tab) => tab.sessionId === id)
    if (existing) {
      setActiveSessionId(id)
      return
    }
    setTabs((prev) => [...prev, { kind: 'history', sessionId: id, title: snapshot.title, snapshot }])
    setActiveSessionId(id)
  }

  async function closeTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.sessionId === id)
    if (tab?.kind === 'session') await window.shovel.session.closeTab(id)
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== id)
      if (activeSessionId === id) {
        setActiveSessionId(next.length > 0 ? next[next.length - 1]!.sessionId : null)
      }
      return next
    })
  }

  function renameTab(sessionId: string, title: string): void {
    setTabs((prev) => prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, title } : tab)))
  }

  function togglePanel(panel: SidebarPanel): void {
    setOpenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(panel)) next.delete(panel)
      else next.add(panel)
      return next
    })
  }

  const tabIds = tabs.map((tab) => tab.sessionId)
  useTabSwitchShortcuts(tabIds, setActiveSessionId)

  if (!projectId) {
    return <div className="p-4 text-sm text-muted-foreground">{t('mainWindow.noProject')}</div>
  }

  const tabInfos: TabInfo[] = tabs.map((tab) => ({ sessionId: tab.sessionId, title: tab.title }))
  const activeTab = tabs.find((tab) => tab.sessionId === activeSessionId) ?? null

  return (
    <div className="flex h-screen flex-col">
      <Header
        displayName={project?.displayName ?? '…'}
        status={project?.status ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projectId={projectId}
          openPanels={openPanels}
          onTogglePanel={togglePanel}
          commandsOpen={commandsOpen}
          onToggleCommands={() => setCommandsOpen((v) => !v)}
          tabs={tabInfos}
          activeSessionId={activeSessionId}
          onSelectTab={setActiveSessionId}
          onOpenFile={openFile}
          onOpenHistory={openHistory}
          onRenameTab={renameTab}
          onCloseTab={(id) => void closeTab(id)}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabInfos}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void closeTab(id)}
            onNew={() => void openNewTab()}
            canAddTab={sessionTabCount < MAX_SESSION_TABS}
          />
          {error && <p className="px-3 py-1 text-xs text-destructive">{error}</p>}
          <div className="flex flex-1 flex-col overflow-hidden">
            {tabs.map((tab) => (
              <div
                key={tab.sessionId}
                className={
                  tab.sessionId === activeTab?.sessionId ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'
                }
              >
                {tab.kind === 'session' ? (
                  <SessionView sessionId={tab.sessionId} initialMeta={tab.meta} />
                ) : tab.kind === 'history' ? (
                  <HistoryView snapshot={tab.snapshot} onStartNew={() => void openNewTab()} />
                ) : tab.isMarkdown ? (
                  <MarkdownEditor projectId={projectId} relPath={tab.relPath} />
                ) : (
                  <FileViewer projectId={projectId} relPath={tab.relPath} />
                )}
              </div>
            ))}
            {tabs.length === 0 && !error && (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {t('mainWindow.connecting')}
              </div>
            )}
          </div>
          {commandsOpen && (
            <div className="h-64 shrink-0 border-t border-border">
              <Commands projectId={projectId} />
            </div>
          )}
        </div>
      </div>
      {settings && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onUpdate={(patch) => void updateSettings(patch)}
        />
      )}
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        projectId={projectId}
        onConfirmed={() => void openNewTab()}
      />
    </div>
  )
}
