import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
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
import { isAuthRequiredMessage } from '@shared/authMarker'
import { useTabSwitchShortcuts } from './useTabShortcuts'
import { addAttachmentToSession } from './attachmentRegistry'
import { friendlyErrorMessage } from '../shared/friendlyError'

const MAX_SESSION_TABS = 10

type Tab =
  | { kind: 'session'; sessionId: string; title: string; meta: SessionMeta; initialAttachments: string[] }
  | { kind: 'file'; sessionId: string; title: string; relPath: string; isMarkdown: boolean }
  | { kind: 'history'; sessionId: string; title: string; snapshot: SessionSnapshot }

function getProjectIdFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('projectId')
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [projectId] = useState(getProjectIdFromQuery)
  const [allProjects, setAllProjects] = useState<ProjectWithStatus[]>([])
  const [project, setProject] = useState<ProjectWithStatus | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPanels, setOpenPanels] = useState<Set<SidebarPanel>>(new Set(['tabs']))
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [lastOpenedFilePath, setLastOpenedFilePath] = useState<string | null>(null)
  const { settings, update: updateSettings } = useSettings()

  useEffect(() => {
    if (!projectId) return
    void window.shovel.projects.list().then((projects) => {
      setAllProjects(projects)
      setProject(projects.find((p) => p.id === projectId) ?? null)
    })
  }, [projectId])

  const sessionTabCount = tabs.filter((tab) => tab.kind === 'session').length

  async function openNewTab(): Promise<void> {
    if (!projectId || sessionTabCount >= MAX_SESSION_TABS) return
    setError(null)

    try {
      // flows.md §1-2: 接続前に高速な事前チェックを行い、未ログインなら接続を
      // 試みずに認証画面を出す。`sbx` 自体が無い等でこのチェック自体が失敗
      // した場合も、下の catch でエラー表示に落とす（画面が固まらないように）。
      const status = await window.shovel.auth.status(projectId)
      if (!status.checkFailed && !status.loggedIn) {
        setAuthOpen(true)
        return
      }

      const { sessionId, meta } = await window.shovel.session.openTab(projectId)
      // ui.md §7: アクティブファイルの自動添付は設定項目（既定 off）。
      // ここでは「タブを開いた時点で最後に開いていたファイル」を初期チップとして
      // 種付けする、という簡略化で実装している。
      const initialAttachments = settings?.autoAttachActiveFile && lastOpenedFilePath ? [lastOpenedFilePath] : []
      setTabs((prev) => [
        ...prev,
        { kind: 'session', sessionId, title: `Tab ${sessionTabCount + 1}`, meta, initialAttachments }
      ])
      setActiveSessionId(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 事前チェックを素通りしても、トークン期限切れ等で接続時に認証エラーに
      // なることがある。同じ認証画面へ導く（flows.md §1-2「両方持つ」）。
      if (isAuthRequiredMessage(message)) {
        setAuthOpen(true)
        return
      }
      setError(friendlyErrorMessage(message, t))
    }
  }

  useEffect(() => {
    if (projectId && tabs.length === 0) void openNewTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  function openFile(relPath: string, isMarkdown: boolean): void {
    setLastOpenedFilePath(relPath)
    const id = `file:${relPath}`
    // 重複判定は updater の中で行う。ダブルクリック等で同じ tick に2回呼ばれると、
    // クロージャの `tabs` はまだ古いままなので、外で判定すると同じ id のタブが
    // 2つ積まれてしまう（同じ id が2つあると両方が「アクティブ」に一致して
    // 上下に並んで描かれる）。
    setTabs((prev) =>
      prev.some((tab) => tab.sessionId === id)
        ? prev
        : [...prev, { kind: 'file', sessionId: id, title: relPath.split('/').pop() ?? relPath, relPath, isMarkdown }]
    )
    setActiveSessionId(id)
  }

  /** ui.md §7: ファイラーの右クリック「コンテキストに追加」。アクティブなセッションタブへ渡す。 */
  function addToContext(relPath: string): void {
    if (activeSessionId) addAttachmentToSession(activeSessionId, relPath)
  }

  function openHistory(snapshot: SessionSnapshot): void {
    const id = `history:${snapshot.sessionId}`
    setTabs((prev) =>
      prev.some((tab) => tab.sessionId === id)
        ? prev
        : [...prev, { kind: 'history', sessionId: id, title: snapshot.title, snapshot }]
    )
    setActiveSessionId(id)
  }

  /**
   * decisions.md C-1/C-2: 履歴タブの「再開」。main 側が `session/load` か
   * `session/resume` で文脈を繋ぎ直し、成功したら読み取り専用の履歴タブを
   * その場でライブのセッションタブへ差し替える。タブ id は元のスナップショット
   * の id をそのまま引き継ぐ（main 側も同じ id でタブを開いている）。
   */
  async function resumeHistory(snapshot: SessionSnapshot): Promise<void> {
    if (!projectId) return
    const { sessionId, meta } = await window.shovel.session.resumeTab(projectId, snapshot.sessionId)
    setTabs((prev) =>
      prev.map((tab) =>
        tab.sessionId === `history:${snapshot.sessionId}`
          ? { kind: 'session', sessionId, title: snapshot.title, meta, initialAttachments: [] }
          : tab
      )
    )
    setActiveSessionId(sessionId)
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
        currentProjectId={projectId}
        recentProjects={allProjects}
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
          onAddToContext={addToContext}
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
          {error && (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button className="shrink-0 font-medium hover:underline" onClick={() => void openNewTab()}>
                {t('common.retry')}
              </button>
            </div>
          )}
          <div className="flex flex-1 flex-col overflow-hidden">
            {tabs.map((tab) => (
              <div
                key={tab.sessionId}
                className={
                  tab.sessionId === activeTab?.sessionId ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'
                }
              >
                {tab.kind === 'session' ? (
                  <SessionView
                    sessionId={tab.sessionId}
                    initialMeta={tab.meta}
                    initialAttachments={tab.initialAttachments}
                    onOpenFile={(relPath) => openFile(relPath, relPath.toLowerCase().endsWith('.md'))}
                  />
                ) : tab.kind === 'history' ? (
                  <HistoryView
                    snapshot={tab.snapshot}
                    onResume={() => resumeHistory(tab.snapshot)}
                    onStartNew={() => void openNewTab()}
                  />
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
