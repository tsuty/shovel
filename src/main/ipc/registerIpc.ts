import { ipcMain } from 'electron'
import { IpcChannel, type CreateExistingDirRequest, type CreateFromExistingRequest, type CreateNewDirRequest } from '@shared/ipc'
import type { TranscriptAction } from '@shared/types/transcript'
import type { AppSettings } from '@shared/types/settings'
import { AGENT_TABLE } from '@shared/agentTable'
import {
  createFromExistingDirectory,
  createFromExistingSandbox,
  createFromNewDirectory,
  diagnose,
  listImportableSandboxes,
  listProjectsWithStatus,
  pickDirectory,
  removeProject,
  renameProject
} from '../domain/projectService'
import { openSandboxTerminal } from '../domain/terminal'
import { openProjectWindow } from '../windows/mainWindow'
import { openProjectManagerWindow } from '../windows/projectManagerWindow'
import { projectsStore, settingsStore } from '../persistence/store'
import {
  cancelSession,
  closeTab,
  dispatchTranscriptAction,
  openTab,
  promptSession,
  refreshTab,
  setSessionConfigOption,
  setSessionMode
} from '../domain/sessionManager'
import {
  copyEntry,
  deleteEntry,
  listDir,
  moveEntry,
  openInOS,
  readFileForViewer,
  renameEntry,
  writeTextFile
} from '../domain/filerService'
import { diffFile, listChanges, restoreAll, restoreOne } from '../domain/changesService'
import { cancelRun, commandHistory, runCommand, sendInput } from '../domain/commandService'
import { listSnapshotsForProject } from '../persistence/snapshot'

export function registerIpc(): void {
  ipcMain.handle(IpcChannel.AppOpenProjectManager, () => openProjectManagerWindow())
  ipcMain.handle(IpcChannel.SettingsGet, () => settingsStore.get())
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<AppSettings>) => settingsStore.set(patch))
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
  ipcMain.handle(IpcChannel.ProjectsOpenTerminal, (_event, id: string) => {
    const project = projectsStore.list().find((p) => p.id === id)
    if (!project) throw new Error(`project not found: ${id}`)
    openSandboxTerminal(project.sandboxName)
  })

  ipcMain.handle(IpcChannel.AgentsList, () => AGENT_TABLE)

  ipcMain.handle(IpcChannel.SessionOpenTab, (event, projectId: string) => openTab(projectId, event.sender))
  ipcMain.handle(IpcChannel.SessionCloseTab, (_event, sessionId: string) => closeTab(sessionId))
  ipcMain.handle(IpcChannel.SessionRefresh, (_event, sessionId: string) => refreshTab(sessionId))
  ipcMain.handle(IpcChannel.SessionPrompt, (_event, sessionId: string, text: string) =>
    promptSession(sessionId, text)
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
  ipcMain.handle(IpcChannel.SessionListHistory, (_event, projectId: string) =>
    listSnapshotsForProject(projectId)
  )

  ipcMain.handle(IpcChannel.FsList, (_event, projectId: string, relPath: string, showGit?: boolean) =>
    listDir(projectId, relPath, showGit ?? false)
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

  ipcMain.handle(IpcChannel.ChangesList, (_event, projectId: string) => listChanges(projectId))
  ipcMain.handle(IpcChannel.ChangesDiff, (_event, projectId: string, relPath: string) =>
    diffFile(projectId, relPath)
  )
  ipcMain.handle(IpcChannel.ChangesRestoreOne, (_event, projectId: string, relPath: string) =>
    restoreOne(projectId, relPath)
  )
  ipcMain.handle(IpcChannel.ChangesRestoreAll, (_event, projectId: string) => restoreAll(projectId))

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
}
