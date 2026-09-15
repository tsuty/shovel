import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type ProjectProgress, type RendererApi, type SessionEnvelope } from '@shared/ipc'
import type { CommandExit, CommandOutputChunk } from '@shared/types/command'

/**
 * `contextBridge` で型付き API のみを renderer に公開する。Node の API を
 * 直接渡さない（architecture.md §2 / §5）。
 */
const api: RendererApi = {
  platform: process.platform,
  app: {
    openProjectManager: () => ipcRenderer.invoke(IpcChannel.AppOpenProjectManager)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.SettingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch)
  },
  auth: {
    status: (projectId) => ipcRenderer.invoke(IpcChannel.AuthStatus, projectId),
    setApiKey: (projectId, apiKey) => ipcRenderer.invoke(IpcChannel.AuthSetApiKey, projectId, apiKey),
    openLoginTerminal: (projectId) => ipcRenderer.invoke(IpcChannel.AuthOpenLoginTerminal, projectId)
  },
  projects: {
    list: () => ipcRenderer.invoke(IpcChannel.ProjectsList),
    createNewDir: (req) => ipcRenderer.invoke(IpcChannel.ProjectsCreateNewDir, req),
    createExistingDir: (req) => ipcRenderer.invoke(IpcChannel.ProjectsCreateExistingDir, req),
    listImportable: () => ipcRenderer.invoke(IpcChannel.ProjectsListImportable),
    createFromExisting: (req) => ipcRenderer.invoke(IpcChannel.ProjectsCreateFromExisting, req),
    rename: (id, displayName) => ipcRenderer.invoke(IpcChannel.ProjectsRename, id, displayName),
    remove: (id, trashHostDir) => ipcRenderer.invoke(IpcChannel.ProjectsRemove, id, trashHostDir),
    open: (id) => ipcRenderer.invoke(IpcChannel.ProjectsOpen, id),
    pickBaseDirectory: () => ipcRenderer.invoke(IpcChannel.ProjectsPickBaseDirectory),
    diagnose: () => ipcRenderer.invoke(IpcChannel.ProjectsDiagnose),
    diagnostics: (id) => ipcRenderer.invoke(IpcChannel.ProjectsDiagnostics, id),
    stop: (id) => ipcRenderer.invoke(IpcChannel.ProjectsStop, id),
    openTerminal: (id) => ipcRenderer.invoke(IpcChannel.ProjectsOpenTerminal, id),
    onProgress: (cb) => {
      const listener = (_event: unknown, payload: ProjectProgress): void => cb(payload)
      ipcRenderer.on(IpcChannel.ProjectsProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannel.ProjectsProgress, listener)
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IpcChannel.AgentsList)
  },
  session: {
    openTab: (projectId) => ipcRenderer.invoke(IpcChannel.SessionOpenTab, projectId),
    closeTab: (sessionId) => ipcRenderer.invoke(IpcChannel.SessionCloseTab, sessionId),
    refresh: (sessionId) => ipcRenderer.invoke(IpcChannel.SessionRefresh, sessionId),
    prompt: (sessionId, text) => ipcRenderer.invoke(IpcChannel.SessionPrompt, sessionId, text),
    cancel: (sessionId) => ipcRenderer.invoke(IpcChannel.SessionCancel, sessionId),
    setMode: (sessionId, modeId) => ipcRenderer.invoke(IpcChannel.SessionSetMode, sessionId, modeId),
    setConfigOption: (sessionId, configId, value) =>
      ipcRenderer.invoke(IpcChannel.SessionSetConfigOption, sessionId, configId, value),
    dispatch: (action) => ipcRenderer.invoke(IpcChannel.SessionAction, action),
    onEvent: (cb) => {
      const listener = (_event: unknown, payload: SessionEnvelope): void => cb(payload)
      ipcRenderer.on(IpcChannel.TranscriptEvent, listener)
      return () => ipcRenderer.removeListener(IpcChannel.TranscriptEvent, listener)
    },
    listHistory: (projectId) => ipcRenderer.invoke(IpcChannel.SessionListHistory, projectId)
  },
  fs: {
    list: (projectId, relPath, showGit) => ipcRenderer.invoke(IpcChannel.FsList, projectId, relPath, showGit),
    readFile: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.FsReadFile, projectId, relPath),
    writeTextFile: (projectId, relPath, content) =>
      ipcRenderer.invoke(IpcChannel.FsWriteTextFile, projectId, relPath, content),
    rename: (projectId, relPath, newName) =>
      ipcRenderer.invoke(IpcChannel.FsRename, projectId, relPath, newName),
    remove: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.FsDelete, projectId, relPath),
    move: (projectId, relPath, destDirRelPath) =>
      ipcRenderer.invoke(IpcChannel.FsMove, projectId, relPath, destDirRelPath),
    copy: (projectId, relPath, destDirRelPath) =>
      ipcRenderer.invoke(IpcChannel.FsCopy, projectId, relPath, destDirRelPath),
    openInOS: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.FsOpenInOS, projectId, relPath)
  },
  changes: {
    list: (projectId) => ipcRenderer.invoke(IpcChannel.ChangesList, projectId),
    diff: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.ChangesDiff, projectId, relPath),
    restoreOne: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.ChangesRestoreOne, projectId, relPath),
    restoreAll: (projectId) => ipcRenderer.invoke(IpcChannel.ChangesRestoreAll, projectId)
  },
  command: {
    run: (projectId, command) => ipcRenderer.invoke(IpcChannel.CommandRun, projectId, command),
    sendInput: (runId, text) => ipcRenderer.invoke(IpcChannel.CommandSendInput, runId, text),
    cancel: (runId) => ipcRenderer.invoke(IpcChannel.CommandCancel, runId),
    history: (projectId) => ipcRenderer.invoke(IpcChannel.CommandHistory, projectId),
    onOutput: (cb) => {
      const listener = (_event: unknown, payload: CommandOutputChunk): void => cb(payload)
      ipcRenderer.on(IpcChannel.CommandOutput, listener)
      return () => ipcRenderer.removeListener(IpcChannel.CommandOutput, listener)
    },
    onExit: (cb) => {
      const listener = (_event: unknown, payload: CommandExit): void => cb(payload)
      ipcRenderer.on(IpcChannel.CommandExit, listener)
      return () => ipcRenderer.removeListener(IpcChannel.CommandExit, listener)
    }
  }
}

contextBridge.exposeInMainWorld('shovel', api)
