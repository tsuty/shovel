import { BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannel,
  type CreateExistingDirRequest,
  type CreateFromExistingRequest,
  type CreateNewDirRequest,
  type DataDirKind
} from '@shared/ipc'
import type { TranscriptAction } from '@shared/types/transcript'
import type { AppSettings } from '@shared/types/settings'
import { AGENT_TABLE } from '@shared/agentTable'
import {
  createFromExistingDirectory,
  createFromExistingSandbox,
  createFromNewDirectory,
  diagnose,
  getProjectDiagnostics,
  openDataDir,
  listImportableSandboxes,
  listProjectsWithStatus,
  pickDirectory,
  removeProject,
  renameProject,
  stopProject
} from '../domain/projectService'
import { openSandboxTerminal } from '../domain/terminal'
import { checkAuthStatus, openLoginTerminal, setApiKey } from '../domain/authService'
import { openProjectWindow } from '../windows/mainWindow'
import { openProjectManagerWindow } from '../windows/projectManagerWindow'
import { projectsStore, settingsStore, sidebarStore } from '../persistence/store'
import {
  cancelSession,
  closeTab,
  deleteHistorySession,
  dispatchTranscriptAction,
  listHistory,
  openTab,
  resumeAgentSession,
  resumeTab,
  promptSession,
  refreshTab,
  renameSession,
  setSessionConfigOption,
  setSessionMode
} from '../domain/sessionManager'
import {
  copyEntry,
  copyExternalEntries,
  createDirectory,
  createMarkdownFile,
  createMermaidFile,
  deleteEntry,
  listDir,
  moveEntry,
  openInOS,
  readClipboardFilePaths,
  readFileForViewer,
  renameEntry,
  writeTextFile
} from '../domain/filerService'
import { cancelRun, commandHistory, removeCommandHistory, runCommand, sendInput } from '../domain/commandService'
import { listLocalRecords, readLocalRecord } from '../persistence/snapshot'
import { searchLocalRecords } from '../domain/localSearch'

export function registerIpc(): void {
  ipcMain.handle(IpcChannel.AppOpenProjectManager, () => openProjectManagerWindow())
  ipcMain.handle(IpcChannel.SettingsGet, () => settingsStore.get())
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<AppSettings>) => {
    const next = settingsStore.set(patch)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(IpcChannel.SettingsChanged, next)
    }
    return next
  })
  ipcMain.handle(IpcChannel.SidebarGetWidths, () => sidebarStore.getWidths())
  ipcMain.handle(IpcChannel.SidebarSetWidth, (_event, panel: string, width: number) =>
    sidebarStore.setWidth(panel, width)
  )

  ipcMain.handle(IpcChannel.AuthStatus, (_event, projectId: string) => checkAuthStatus(projectId))
  ipcMain.handle(IpcChannel.AuthSetApiKey, (_event, projectId: string, apiKey: string) =>
    setApiKey(projectId, apiKey)
  )
  ipcMain.handle(IpcChannel.AuthOpenLoginTerminal, (_event, projectId: string) => openLoginTerminal(projectId))
  ipcMain.handle(IpcChannel.ProjectsList, () => listProjectsWithStatus())

  ipcMain.handle(IpcChannel.ProjectsCreateNewDir, async (event, req: CreateNewDirRequest) => {
    return createFromNewDirectory(req, (progress) => event.sender.send(IpcChannel.ProjectsProgress, progress))
  })

  ipcMain.handle(IpcChannel.ProjectsCreateExistingDir, async (event, req: CreateExistingDirRequest) => {
    return createFromExistingDirectory(req, (progress) =>
      event.sender.send(IpcChannel.ProjectsProgress, progress)
    )
  })

  ipcMain.handle(IpcChannel.ProjectsListImportable, () => listImportableSandboxes())
  ipcMain.handle(IpcChannel.ProjectsCreateFromExisting, (_event, req: CreateFromExistingRequest) =>
    createFromExistingSandbox(req)
  )
  ipcMain.handle(IpcChannel.ProjectsRename, (_event, id: string, displayName: string) =>
    renameProject(id, displayName)
  )
  ipcMain.handle(IpcChannel.ProjectsRemove, (_event, id: string, trashHostDir: boolean) =>
    removeProject(id, trashHostDir)
  )
  ipcMain.handle(IpcChannel.ProjectsOpen, (_event, id: string) => {
    const project = projectsStore.list().find((p) => p.id === id)
    if (!project) throw new Error(`project not found: ${id}`)
    openProjectWindow(id)
  })
  ipcMain.handle(IpcChannel.ProjectsPickBaseDirectory, () => pickDirectory())
  ipcMain.handle(IpcChannel.ProjectsDiagnose, () => diagnose())
  ipcMain.handle(IpcChannel.ProjectsDiagnostics, (_event, id: string) => getProjectDiagnostics(id))
  ipcMain.handle(IpcChannel.ProjectsStop, (_event, id: string) => stopProject(id))
  ipcMain.handle(IpcChannel.ProjectsOpenDataDir, (_event, id: string, kind: DataDirKind) => openDataDir(id, kind))
  ipcMain.handle(IpcChannel.ProjectsOpenTerminal, (_event, id: string) => {
    const project = projectsStore.list().find((p) => p.id === id)
    if (!project) throw new Error(`project not found: ${id}`)
    openSandboxTerminal(project.sandboxName)
  })

  ipcMain.handle(IpcChannel.AgentsList, () => AGENT_TABLE)

  ipcMain.handle(IpcChannel.SessionOpenTab, (event, projectId: string) => openTab(projectId, event.sender))
  ipcMain.handle(IpcChannel.SessionResumeTab, (event, projectId: string, snapshotSessionId: string) =>
    resumeTab(projectId, snapshotSessionId, event.sender)
  )
  ipcMain.handle(IpcChannel.SessionCloseTab, (_event, sessionId: string) => closeTab(sessionId))
  ipcMain.handle(IpcChannel.SessionRefresh, (_event, sessionId: string) => refreshTab(sessionId))
  ipcMain.handle(
    IpcChannel.SessionPrompt,
    (_event, sessionId: string, text: string, attachmentRelPaths?: string[]) =>
      promptSession(sessionId, text, attachmentRelPaths)
  )
  ipcMain.handle(IpcChannel.SessionCancel, (_event, sessionId: string) => cancelSession(sessionId))
  ipcMain.handle(IpcChannel.SessionSetMode, (_event, sessionId: string, modeId: string) =>
    setSessionMode(sessionId, modeId)
  )
  ipcMain.handle(
    IpcChannel.SessionSetConfigOption,
    (_event, sessionId: string, configId: string, value: string | boolean) =>
      setSessionConfigOption(sessionId, configId, value)
  )
  ipcMain.handle(IpcChannel.SessionAction, (_event, action: TranscriptAction) =>
    dispatchTranscriptAction(action)
  )
  ipcMain.handle(IpcChannel.SessionListHistory, (_event, projectId: string) => listHistory(projectId))
  ipcMain.handle(
    IpcChannel.SessionResumeAgentSession,
    (event, projectId: string, acpSessionId: string, title?: string) =>
      resumeAgentSession(projectId, acpSessionId, title, event.sender)
  )
  ipcMain.handle(IpcChannel.SessionRename, (_event, projectId: string, sessionId: string, title: string) =>
    renameSession(projectId, sessionId, title)
  )
  ipcMain.handle(
    IpcChannel.SessionDeleteHistory,
    (_event, projectId: string, target: { snapshotId?: string; acpSessionId?: string }) =>
      deleteHistorySession(projectId, target)
  )
  ipcMain.handle(IpcChannel.SessionListLocalRecords, (_event, projectId: string) => listLocalRecords(projectId))
  ipcMain.handle(IpcChannel.SessionReadLocalRecord, (_event, projectId: string, fileName: string) =>
    readLocalRecord(projectId, fileName)
  )
  ipcMain.handle(
    IpcChannel.SessionSearchLocal,
    (event, projectId: string, query: string, includeDeleted: boolean) =>
      searchLocalRecords(event.sender.id, projectId, query, includeDeleted)
  )

  ipcMain.handle(IpcChannel.FsList, (_event, projectId: string, relPath: string) => listDir(projectId, relPath))
  ipcMain.handle(IpcChannel.FsReadClipboardFiles, () => readClipboardFilePaths())
  ipcMain.handle(
    IpcChannel.FsCopyExternal,
    (_event, projectId: string, absPaths: string[], destDirRelPath: string) =>
      copyExternalEntries(projectId, absPaths, destDirRelPath)
  )
  ipcMain.handle(IpcChannel.FsReadFile, (_event, projectId: string, relPath: string) =>
    readFileForViewer(projectId, relPath)
  )
  ipcMain.handle(
    IpcChannel.FsWriteTextFile,
    (_event, projectId: string, relPath: string, content: string) =>
      writeTextFile(projectId, relPath, content)
  )
  ipcMain.handle(IpcChannel.FsRename, (_event, projectId: string, relPath: string, newName: string) =>
    renameEntry(projectId, relPath, newName)
  )
  ipcMain.handle(IpcChannel.FsDelete, (_event, projectId: string, relPath: string) =>
    deleteEntry(projectId, relPath)
  )
  ipcMain.handle(
    IpcChannel.FsMove,
    (_event, projectId: string, relPath: string, destDirRelPath: string) =>
      moveEntry(projectId, relPath, destDirRelPath)
  )
  ipcMain.handle(
    IpcChannel.FsCopy,
    (_event, projectId: string, relPath: string, destDirRelPath: string) =>
      copyEntry(projectId, relPath, destDirRelPath)
  )
  ipcMain.handle(IpcChannel.FsOpenInOS, (_event, projectId: string, relPath: string) =>
    openInOS(projectId, relPath)
  )
  ipcMain.handle(IpcChannel.FsMkdir, (_event, projectId: string, parentRelPath: string) =>
    createDirectory(projectId, parentRelPath)
  )
  ipcMain.handle(IpcChannel.FsCreateMarkdownFile, (_event, projectId: string, parentRelPath: string) =>
    createMarkdownFile(projectId, parentRelPath)
  )
  ipcMain.handle(IpcChannel.FsCreateMermaidFile, (_event, projectId: string, parentRelPath: string) =>
    createMermaidFile(projectId, parentRelPath)
  )

  ipcMain.handle(IpcChannel.CommandRun, (event, projectId: string, command: string) => {
    const runId = runCommand(projectId, command, {
      onOutput: (stream, text) => {
        if (event.sender.isDestroyed()) return
        event.sender.send(IpcChannel.CommandOutput, { runId, stream, text })
      },
      onExit: (code) => {
        if (event.sender.isDestroyed()) return
        event.sender.send(IpcChannel.CommandExit, { runId, code })
      }
    })
    return { runId }
  })
  ipcMain.handle(IpcChannel.CommandSendInput, (_event, runId: string, text: string) => sendInput(runId, text))
  ipcMain.handle(IpcChannel.CommandCancel, (_event, runId: string) => cancelRun(runId))
  ipcMain.handle(IpcChannel.CommandHistory, (_event, projectId: string) => commandHistory(projectId))
  ipcMain.handle(IpcChannel.CommandRemoveHistory, (_event, projectId: string, command: string) =>
    removeCommandHistory(projectId, command)
  )
}
