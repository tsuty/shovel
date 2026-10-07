import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel, type ProjectProgress, type RendererApi, type SessionEnvelope, type SessionOpenProgress } from '@shared/ipc'
import type { CommandExit, CommandOutputChunk } from '@shared/types/command'
import type { AppSettings } from '@shared/types/settings'

/** `contextBridge` で型付き API を renderer に公開する。 */
const api: RendererApi = {
  platform: process.platform,
  app: {
    openProjectManager: () => ipcRenderer.invoke(IpcChannel.AppOpenProjectManager)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.SettingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch),
    onChanged: (cb) => {
      const listener = (_event: unknown, settings: AppSettings): void => cb(settings)
      ipcRenderer.on(IpcChannel.SettingsChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannel.SettingsChanged, listener)
    }
  },
  sidebar: {
    getWidths: () => ipcRenderer.invoke(IpcChannel.SidebarGetWidths),
    setWidth: (panel, width) => ipcRenderer.invoke(IpcChannel.SidebarSetWidth, panel, width)
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
    openSbxLogin: () => ipcRenderer.invoke(IpcChannel.ProjectsOpenSbxLogin),
    openDataDir: (id, kind) => ipcRenderer.invoke(IpcChannel.ProjectsOpenDataDir, id, kind),
    onProgress: (cb) => {
      const listener = (_event: unknown, payload: ProjectProgress): void => cb(payload)
      ipcRenderer.on(IpcChannel.ProjectsProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannel.ProjectsProgress, listener)
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IpcChannel.AgentsList),
    acpUpdateOffer: (projectId) => ipcRenderer.invoke(IpcChannel.AgentsAcpUpdateOffer, projectId),
    resolveAcpUpdate: (projectId, update) => ipcRenderer.invoke(IpcChannel.AgentsResolveAcpUpdate, projectId, update)
  },
  session: {
    openTab: (projectId, requestId) => ipcRenderer.invoke(IpcChannel.SessionOpenTab, projectId, requestId),
    onOpenProgress: (cb) => {
      const listener = (_event: unknown, payload: SessionOpenProgress): void => cb(payload)
      ipcRenderer.on(IpcChannel.SessionOpenProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannel.SessionOpenProgress, listener)
    },
    resumeTab: (projectId, snapshotSessionId) =>
      ipcRenderer.invoke(IpcChannel.SessionResumeTab, projectId, snapshotSessionId),
    resumeAgentSession: (projectId, acpSessionId, title) =>
      ipcRenderer.invoke(IpcChannel.SessionResumeAgentSession, projectId, acpSessionId, title),
    closeTab: (sessionId) => ipcRenderer.invoke(IpcChannel.SessionCloseTab, sessionId),
    refresh: (sessionId) => ipcRenderer.invoke(IpcChannel.SessionRefresh, sessionId),
    prompt: (sessionId, text, attachmentRelPaths) =>
      ipcRenderer.invoke(IpcChannel.SessionPrompt, sessionId, text, attachmentRelPaths),
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
    listHistory: (projectId) => ipcRenderer.invoke(IpcChannel.SessionListHistory, projectId),
    rename: (projectId, sessionId, title) => ipcRenderer.invoke(IpcChannel.SessionRename, projectId, sessionId, title),
    deleteHistory: (projectId, target) => ipcRenderer.invoke(IpcChannel.SessionDeleteHistory, projectId, target),
    listLocalRecords: (projectId) => ipcRenderer.invoke(IpcChannel.SessionListLocalRecords, projectId),
    readLocalRecord: (projectId, fileName) => ipcRenderer.invoke(IpcChannel.SessionReadLocalRecord, projectId, fileName),
    searchLocal: (projectId, query, includeDeleted) =>
      ipcRenderer.invoke(IpcChannel.SessionSearchLocal, projectId, query, includeDeleted),
    onLocalRecordsChanged: (cb) => {
      const listener = (_event: unknown, projectId: string): void => cb(projectId)
      ipcRenderer.on(IpcChannel.SessionLocalRecordsChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannel.SessionLocalRecordsChanged, listener)
    }
  },
  fs: {
    list: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.FsList, projectId, relPath),
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
    openInOS: (projectId, relPath) => ipcRenderer.invoke(IpcChannel.FsOpenInOS, projectId, relPath),
    mkdir: (projectId, parentRelPath) => ipcRenderer.invoke(IpcChannel.FsMkdir, projectId, parentRelPath),
    createFile: (projectId, parentRelPath, kind) =>
      ipcRenderer.invoke(IpcChannel.FsCreateFile, projectId, parentRelPath, kind),
    readClipboardFiles: () => ipcRenderer.invoke(IpcChannel.FsReadClipboardFiles),
    copyExternal: (projectId, absPaths, destDirRelPath) =>
      ipcRenderer.invoke(IpcChannel.FsCopyExternal, projectId, absPaths, destDirRelPath),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  command: {
    run: (projectId, command) => ipcRenderer.invoke(IpcChannel.CommandRun, projectId, command),
    sendInput: (runId, text) => ipcRenderer.invoke(IpcChannel.CommandSendInput, runId, text),
    cancel: (runId) => ipcRenderer.invoke(IpcChannel.CommandCancel, runId),
    history: (projectId) => ipcRenderer.invoke(IpcChannel.CommandHistory, projectId),
    removeHistory: (projectId, command) => ipcRenderer.invoke(IpcChannel.CommandRemoveHistory, projectId, command),
    pin: (projectId, command) => ipcRenderer.invoke(IpcChannel.CommandPin, projectId, command),
    unpin: (projectId, command) => ipcRenderer.invoke(IpcChannel.CommandUnpin, projectId, command),
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
