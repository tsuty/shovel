/**
 * main ⇔ renderer の IPC チャンネル定義。
 *
 * トランスクリプトのイベント (`TranscriptEvent`) は SAC のプロトコルをそのまま
 * 継承しているが、SAC は 1 webview = 1 セッションだったのに対し、shovel は
 * 1 ウィンドウ（1 webContents）に最大 10 タブ = 10 セッションが同居する
 * (architecture.md §1)。そのため、イベント自体には sessionId を持たせず、
 * `{ sessionId, event }` の封筒でラップして送る。main が持つ
 * `sessionId → webContents` のマップ (architecture.md §5) は「どのウィンドウに
 * 送るか」を決め、封筒の sessionId が「そのウィンドウの中のどのタブか」を
 * renderer 側で振り分ける。
 */

import type { TranscriptAction, TranscriptEvent } from './types/transcript'
import type { AgentEntry, Project, ProjectWithStatus } from './types/project'
import type { SessionMeta, SessionSnapshot } from './types/session'
import type { FileReadResult, FsEntry } from './types/filer'
import type { ChangesSummary } from './types/changes'
import type { CommandExit, CommandOutputChunk } from './types/command'
import type { AppSettings } from './types/settings'
import type { SbxLsEntry } from './types/sbx'

export const IpcChannel = {
  // renderer -> main (invoke/handle)
  ProjectsList: 'projects:list',
  ProjectsCreateNewDir: 'projects:createNewDir',
  ProjectsCreateExistingDir: 'projects:createExistingDir',
  ProjectsListImportable: 'projects:listImportable',
  ProjectsCreateFromExisting: 'projects:createFromExisting',
  ProjectsRename: 'projects:rename',
  ProjectsRemove: 'projects:remove',
  ProjectsOpen: 'projects:open',
  ProjectsPickBaseDirectory: 'projects:pickBaseDirectory',
  ProjectsDiagnose: 'projects:diagnose',
  ProjectsDiagnostics: 'projects:diagnostics',
  ProjectsStop: 'projects:stop',
  ProjectsOpenTerminal: 'projects:openTerminal',
  AppOpenProjectManager: 'app:openProjectManager',
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SidebarGetWidths: 'sidebar:getWidths',
  SidebarSetWidth: 'sidebar:setWidth',
  AuthStatus: 'auth:status',
  AuthSetApiKey: 'auth:setApiKey',
  AuthOpenLoginTerminal: 'auth:openLoginTerminal',
  AgentsList: 'agents:list',

  SessionOpenTab: 'session:openTab',
  SessionResumeTab: 'session:resumeTab',
  SessionCloseTab: 'session:closeTab',
  SessionRefresh: 'session:refresh',
  SessionPrompt: 'session:prompt',
  SessionCancel: 'session:cancel',
  SessionSetMode: 'session:setMode',
  SessionSetConfigOption: 'session:setConfigOption',
  SessionAction: 'session:action', // TranscriptAction (openFile / copyText / permission 等)
  SessionListHistory: 'session:listHistory',
  SessionRename: 'session:rename',
  SessionDeleteHistory: 'session:deleteHistory',

  FsList: 'fs:list',
  FsReadFile: 'fs:readFile',
  FsWriteTextFile: 'fs:writeTextFile',
  FsRename: 'fs:rename',
  FsDelete: 'fs:delete',
  FsMove: 'fs:move',
  FsCopy: 'fs:copy',
  FsOpenInOS: 'fs:openInOS',
  FsMkdir: 'fs:mkdir',
  FsCreateMarkdownFile: 'fs:createMarkdownFile',

  ChangesList: 'changes:list',
  ChangesDiff: 'changes:diff',
  ChangesRestoreOne: 'changes:restoreOne',
  ChangesRestoreAll: 'changes:restoreAll',

  CommandRun: 'command:run',
  CommandSendInput: 'command:sendInput',
  CommandCancel: 'command:cancel',
  CommandHistory: 'command:history',

  // main -> renderer (send)
  TranscriptEvent: 'transcript:event',
  ProjectsProgress: 'projects:progress',
  SandboxStatusChanged: 'sandbox:statusChanged',
  CommandOutput: 'command:output',
  CommandExit: 'command:exit'
} as const

export interface CreateNewDirRequest {
  agentId: string
  displayName: string
  baseDir: string
  dirName: string
  sandboxName: string
  gitInit: boolean
}

export interface CreateExistingDirRequest {
  agentId: string
  hostPath: string
  displayName: string
  gitInit: boolean
}

export interface ImportableSandbox {
  sandboxName: string
  sandboxId: string
  agentId: string | null
  sbxAgentRaw: string
  hostPath: string
  status: 'running' | 'stopped'
}

export interface CreateFromExistingRequest {
  sandboxName: string
  displayName: string
}

export interface ProjectProgress {
  step: string
  message: string
}

export interface SessionEnvelope {
  sessionId: string
  event: TranscriptEvent
}

/** ui.md §2「プロジェクトの詳細」の診断情報。まとめてクリップボードにコピーできる。 */
export interface ProjectDiagnostics {
  project: Project
  diagnoseOutput: string
  sbxLsEntry: SbxLsEntry | null
}

export interface RendererApi {
  /** ui.md §3「切り替えショートカットを『修飾キー + 0〜9』に割り当てる」の
   * 修飾キーを OS ごとに出し分けるために使う（macOS は Cmd、それ以外は Ctrl）。 */
  platform: NodeJS.Platform
  app: {
    openProjectManager(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  sidebar: {
    /** ui.md §3「サイズは記憶される」。パネル id(tabs/filer/changes) ごとの幅(px)。 */
    getWidths(): Promise<Record<string, number>>
    setWidth(panel: string, width: number): Promise<void>
  }
  auth: {
    status(projectId: string): Promise<{ loggedIn: boolean; checkFailed: boolean }>
    setApiKey(projectId: string, apiKey: string): Promise<void>
    openLoginTerminal(projectId: string): Promise<void>
  }
  projects: {
    list(): Promise<ProjectWithStatus[]>
    createNewDir(req: CreateNewDirRequest): Promise<Project>
    createExistingDir(req: CreateExistingDirRequest): Promise<Project>
    listImportable(): Promise<ImportableSandbox[]>
    createFromExisting(req: CreateFromExistingRequest): Promise<Project>
    rename(id: string, displayName: string): Promise<void>
    remove(id: string, trashHostDir: boolean): Promise<void>
    open(id: string): Promise<void>
    pickBaseDirectory(): Promise<string | null>
    diagnose(): Promise<string>
    diagnostics(id: string): Promise<ProjectDiagnostics>
    stop(id: string): Promise<void>
    openTerminal(id: string): Promise<void>
    onProgress(cb: (p: ProjectProgress) => void): () => void
  }
  agents: {
    list(): Promise<AgentEntry[]>
  }
  session: {
    openTab(projectId: string): Promise<{ sessionId: string; meta: SessionMeta }>
    /** 過去のセッションを session/load か session/resume で本当に再開する。 */
    resumeTab(projectId: string, snapshotSessionId: string): Promise<{ sessionId: string; meta: SessionMeta }>
    closeTab(sessionId: string): Promise<void>
    refresh(sessionId: string): Promise<void>
    prompt(sessionId: string, text: string, attachmentRelPaths?: string[]): Promise<void>
    cancel(sessionId: string): Promise<void>
    setMode(sessionId: string, modeId: string): Promise<void>
    setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void>
    dispatch(action: TranscriptAction): Promise<void>
    onEvent(cb: (envelope: SessionEnvelope) => void): () => void
    listHistory(projectId: string): Promise<SessionSnapshot[]>
    rename(sessionId: string, title: string): Promise<void>
    deleteHistory(sessionId: string): Promise<void>
  }
  fs: {
    list(projectId: string, relPath: string, showGit?: boolean): Promise<FsEntry[]>
    readFile(projectId: string, relPath: string): Promise<FileReadResult>
    writeTextFile(projectId: string, relPath: string, content: string): Promise<void>
    rename(projectId: string, relPath: string, newName: string): Promise<void>
    remove(projectId: string, relPath: string): Promise<void>
    move(projectId: string, relPath: string, destDirRelPath: string): Promise<void>
    copy(projectId: string, relPath: string, destDirRelPath: string): Promise<string>
    openInOS(projectId: string, relPath: string): Promise<void>
    mkdir(projectId: string, parentRelPath: string): Promise<string>
    createMarkdownFile(projectId: string, parentRelPath: string): Promise<string>
  }
  changes: {
    list(projectId: string): Promise<ChangesSummary>
    diff(projectId: string, relPath: string): Promise<string>
    restoreOne(projectId: string, relPath: string): Promise<void>
    restoreAll(projectId: string): Promise<void>
  }
  command: {
    run(projectId: string, command: string): Promise<{ runId: string }>
    sendInput(runId: string, text: string): Promise<void>
    cancel(runId: string): Promise<void>
    history(projectId: string): Promise<string[]>
    onOutput(cb: (chunk: CommandOutputChunk) => void): () => void
    onExit(cb: (exit: CommandExit) => void): () => void
  }
}
