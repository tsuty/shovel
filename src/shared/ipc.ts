/**
 * main ⇔ renderer の IPC チャンネル定義。
 * トランスクリプトのイベントは `{ sessionId, event }` の封筒でラップして送り、
 * renderer 側で sessionId によってタブへ振り分ける。
 */

import type { TranscriptAction, TranscriptEvent } from './types/transcript'
import type { AcpUpdateOffer, AgentEntry, Project, ProjectListResult } from './types/project'
import type {
  HistoryListing,
  LocalRecordSummary,
  LocalSearchResult,
  RestoredTab,
  SavedTab,
  SessionMeta,
  SessionSnapshot
} from './types/session'
import type { FileReadResult, FileSearchResults, FsEntry, WriteTextResult } from './types/filer'
import type { CommandExit, CommandHistory, CommandOutputChunk, CommandTtyOutput } from './types/command'
import type { AppSettings } from './types/settings'
import type { SbxLsEntry } from './types/sbx'
import type { NetworkBlocks } from './types/network'
import type { NewFileKind } from './fileKinds'

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
  ProjectsOpenSbxLogin: 'projects:openSbxLogin',
  ProjectsOpenDataDir: 'projects:openDataDir',
  ProjectsNetworkBlocks: 'projects:networkBlocks',
  ProjectsAllowNetworkHost: 'projects:allowNetworkHost',
  ProjectsSetNetworkHostIgnored: 'projects:setNetworkHostIgnored',
  AppOpenProjectManager: 'app:openProjectManager',
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsChanged: 'settings:changed',
  SidebarGetWidths: 'sidebar:getWidths',
  SidebarSetWidth: 'sidebar:setWidth',
  TabsRestore: 'tabs:restore',
  TabsSave: 'tabs:save',
  AuthStatus: 'auth:status',
  AuthSetApiKey: 'auth:setApiKey',
  AuthOpenLoginTerminal: 'auth:openLoginTerminal',
  AgentsList: 'agents:list',
  AgentsAcpUpdateOffer: 'agents:acpUpdateOffer',
  AgentsResolveAcpUpdate: 'agents:resolveAcpUpdate',
  AgentsRollbackAcpVersion: 'agents:rollbackAcpVersion',

  SessionOpenTab: 'session:openTab',
  SessionResumeTab: 'session:resumeTab',
  SessionResumeAgentSession: 'session:resumeAgentSession',
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
  SessionListLocalRecords: 'session:listLocalRecords',
  SessionReadLocalRecord: 'session:readLocalRecord',
  SessionSearchLocal: 'session:searchLocal',

  FsList: 'fs:list',
  FsReadFile: 'fs:readFile',
  FsWriteTextFile: 'fs:writeTextFile',
  FsRename: 'fs:rename',
  FsDelete: 'fs:delete',
  FsMove: 'fs:move',
  FsCopy: 'fs:copy',
  FsOpenInOS: 'fs:openInOS',
  FsMkdir: 'fs:mkdir',
  FsCreateFile: 'fs:createFile',
  FsReadClipboardFiles: 'fs:readClipboardFiles',
  FsCopyExternal: 'fs:copyExternal',
  FsSearch: 'fs:search',

  CommandRun: 'command:run',
  CommandRunTty: 'command:runTty',
  CommandSendInput: 'command:sendInput',
  CommandResizeTty: 'command:resizeTty',
  CommandCancel: 'command:cancel',
  CommandHistory: 'command:history',
  CommandRemoveHistory: 'command:removeHistory',
  CommandPin: 'command:pin',
  CommandUnpin: 'command:unpin',

  PrintOpenPreview: 'print:openPreview',
  PrintRun: 'print:run',
  PrintRunHtml: 'print:runHtml',

  // main -> renderer (send)
  TranscriptEvent: 'transcript:event',
  ProjectsProgress: 'projects:progress',
  SandboxStatusChanged: 'sandbox:statusChanged',
  CommandOutput: 'command:output',
  CommandTtyOutput: 'command:ttyOutput',
  CommandExit: 'command:exit',
  SessionLocalRecordsChanged: 'session:localRecordsChanged',
  SessionOpenProgress: 'session:openProgress'
} as const

export interface CreateNewDirRequest {
  agentId: string
  displayName: string
  baseDir: string
  dirName: string
  sandboxName: string
}

export interface CreateExistingDirRequest {
  agentId: string
  hostPath: string
  displayName: string
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

/**
 * 新しいタブを開くまでの段階。
 *   - auth: エージェントの認証状態の確認（renderer が `auth.status` を呼ぶ）
 *   - sandbox: サンドボックスの生存確認（`sbx exec <name> echo`）
 *   - adapter: ACP アダプタの起動と `initialize`（`npx` によるパッケージ取得を含む）
 *   - session: `session/new`（復元時は `session/load` / `session/resume`）
 */
export type SessionOpenStep = 'auth' | 'sandbox' | 'adapter' | 'session'

/** `openTab` の途中経過。`requestId` は renderer が `openTab` に渡した id。 */
export interface SessionOpenProgress {
  requestId: string
  step: SessionOpenStep
  /** 実行しているコマンドやメソッド（表示用）。 */
  detail?: string
}

export interface SessionEnvelope {
  sessionId: string
  event: TranscriptEvent
}

/** プロジェクトの詳細の診断情報。 */
export interface ProjectDiagnostics {
  project: Project
  /** エージェントの表示名（ACP レジストリの `name`。例: `Claude Agent`）。 */
  agentName: string
  diagnoseOutput: string
  sbxLsEntry: SbxLsEntry | null
  /**
   * 最後に開いたセッションのログファイルから抜き出した ACP トラフィック（`IN`/`OUT` 行）と
   * エージェントの `stderr`（`STDERR` 行）。末尾側を `RECENT_LOG_LINES` 行に切り詰める。
   * 一度もセッションを開いていなければ `null`。
   */
  acpTrafficLog: string | null
  stderrLog: string | null
  /** ログ／セッションキャッシュ（スナップショット）の置き場。 */
  logsDir: string
  snapshotsDir: string
}

/** プロジェクト詳細から OS のファイルマネージャーで開けるディレクトリ。 */
export type DataDirKind = 'logs' | 'snapshots'

export interface RendererApi {
  /** タブ切り替えショートカットの修飾キーを出し分けるための OS 種別。 */
  platform: NodeJS.Platform
  app: {
    openProjectManager(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    /** 変更は開いている全ウィンドウに反映する。 */
    onChanged(cb: (settings: AppSettings) => void): () => void
  }
  sidebar: {
    /** パネル id(tabs/filer) ごとの幅(px)。 */
    getWidths(): Promise<Record<string, number>>
    setWidth(panel: string, width: number): Promise<void>
  }
  tabs: {
    /** 前回ウィンドウで開いていたタブ（表示順）。消えたファイル・記録は除いてある。 */
    restore(projectId: string): Promise<RestoredTab[]>
    save(projectId: string, tabs: SavedTab[]): Promise<void>
  }
  auth: {
    status(projectId: string): Promise<{ loggedIn: boolean; checkFailed: boolean }>
    setApiKey(projectId: string, apiKey: string): Promise<void>
    openLoginTerminal(projectId: string): Promise<void>
  }
  projects: {
    list(): Promise<ProjectListResult>
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
    /** OS のターミナルで `sbx login`（Docker へのサインイン）を開く。 */
    openSbxLogin(): Promise<void>
    /**
     * ログ／セッションキャッシュのディレクトリを OS のファイルマネージャーで開く。
     * このプロジェクトの最新のログファイルがあれば、それを選択した状態で開く。
     */
    openDataDir(id: string, kind: DataDirKind): Promise<void>
    /** `sbx policy log` で拒否された通信のうち、いまのルールでもまだ通らないもの。 */
    networkBlocks(id: string): Promise<NetworkBlocks>
    /** 宛先 `host:port` への通信を、このプロジェクトのサンドボックスだけに許可する（`sbx policy allow network --sandbox`）。 */
    allowNetworkHost(id: string, host: string): Promise<void>
    /** 宛先をプロジェクトの無視リストに入れる／外す。 */
    setNetworkHostIgnored(id: string, host: string, ignored: boolean): Promise<void>
    onProgress(cb: (p: ProjectProgress) => void): () => void
  }
  agents: {
    list(): Promise<AgentEntry[]>
    /** ACP アダプタの更新を尋ねるべきなら、その内容。 */
    acpUpdateOffer(projectId: string): Promise<AcpUpdateOffer | null>
    /** 更新の確認への答え（true: 最新版にする、false: 今の版のまま）。 */
    resolveAcpUpdate(projectId: string, update: boolean): Promise<void>
    /** 記録する版を更新前の版（`previousAcpVersion`）に戻す。開いているタブには効かない。 */
    rollbackAcpVersion(projectId: string): Promise<void>
  }
  session: {
    /** `sessionId` はタブ id、`snapshotId` はそのタブがいま書き込んでいるスナップショットの id。 */
    openTab(
      projectId: string,
      requestId?: string
    ): Promise<{ sessionId: string; snapshotId: string; meta: SessionMeta }>
    /** `openTab` の途中経過（`requestId` を渡したときだけ届く）。 */
    onOpenProgress(cb: (progress: SessionOpenProgress) => void): () => void
    /** 過去のセッションを session/load か session/resume で再開する。 */
    resumeTab(
      projectId: string,
      snapshotSessionId: string
    ): Promise<{ sessionId: string; snapshotId: string; meta: SessionMeta }>
    /** 「エージェントのみ」の行（ローカル記録が無い）を再開する。 */
    resumeAgentSession(
      projectId: string,
      acpSessionId: string,
      title?: string
    ): Promise<{ sessionId: string; snapshotId: string; meta: SessionMeta }>
    closeTab(sessionId: string): Promise<void>
    /** ↻。新しい会話のスナップショット id を返す。 */
    refresh(sessionId: string): Promise<string>
    prompt(sessionId: string, text: string, attachmentRelPaths?: string[]): Promise<void>
    cancel(sessionId: string): Promise<void>
    setMode(sessionId: string, modeId: string): Promise<void>
    setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void>
    dispatch(action: TranscriptAction): Promise<void>
    onEvent(cb: (envelope: SessionEnvelope) => void): () => void
    /** 履歴一覧（`session/list` とローカル記録の和集合）。 */
    listHistory(projectId: string): Promise<HistoryListing>
    /** 引数はスナップショット id（開いているタブならその `snapshotId`）。 */
    rename(projectId: string, snapshotId: string, title: string): Promise<void>
    /** ソフトデリート（`.deleted` へ退避。バックアップも一緒に）。 */
    deleteHistory(projectId: string, target: { snapshotId?: string; acpSessionId?: string }): Promise<void>
    /** 現在・バックアップ・削除済みを含む、このプロジェクトの全ローカル記録の要約。 */
    listLocalRecords(projectId: string): Promise<LocalRecordSummary[]>
    /** ファイル名で指定したローカル記録（バックアップ・削除済みを含む）を読む。 */
    readLocalRecord(projectId: string, fileName: string): Promise<SessionSnapshot | null>
    /** ローカルセッション検索。新しい検索に追い越されたときは null。 */
    searchLocal(projectId: string, query: string, includeDeleted: boolean): Promise<LocalSearchResult[] | null>
    /** 履歴一覧を取り直すべきときの通知（引数は projectId）。 */
    onLocalRecordsChanged(cb: (projectId: string) => void): () => void
  }
  fs: {
    list(projectId: string, relPath: string): Promise<FsEntry[]>
    readFile(projectId: string, relPath: string): Promise<FileReadResult>
    writeTextFile(projectId: string, relPath: string, content: string): Promise<WriteTextResult>
    rename(projectId: string, relPath: string, newName: string): Promise<void>
    remove(projectId: string, relPath: string): Promise<void>
    move(projectId: string, relPath: string, destDirRelPath: string): Promise<void>
    copy(projectId: string, relPath: string, destDirRelPath: string): Promise<string>
    openInOS(projectId: string, relPath: string): Promise<void>
    mkdir(projectId: string, parentRelPath: string): Promise<string>
    /** 「新規ファイル」。作ったファイルの相対パスを返す。 */
    createFile(projectId: string, parentRelPath: string, kind: NewFileKind): Promise<string>
    /** OS のクリップボードにある「コピーされたファイル」の絶対パス（無ければ空）。 */
    readClipboardFiles(): Promise<string[]>
    /** アプリ外のファイル・フォルダをプロジェクト内へコピーする（移動はしない）。 */
    copyExternal(projectId: string, absPaths: string[], destDirRelPath: string): Promise<string[]>
    /** ドロップされた `File` のホスト上の絶対パス（Electron の `webUtils.getPathForFile`）。 */
    pathForFile(file: File): string
    /** ファイル名とコンテンツの検索（`scopeRelPath` が空ならプロジェクト全体）。新しい検索に追い越されたときは null。 */
    search(projectId: string, scopeRelPath: string, query: string): Promise<FileSearchResults | null>
  }
  command: {
    run(projectId: string, command: string): Promise<{ runId: string }>
    /** TTY モードで実行する（サンドボックス内に PTY を作る）。`cols`/`rows` は端末の初期サイズ。 */
    runTty(projectId: string, command: string, cols: number, rows: number): Promise<{ runId: string }>
    sendInput(runId: string, text: string): Promise<void>
    resizeTty(runId: string, cols: number, rows: number): Promise<void>
    cancel(runId: string): Promise<void>
    history(projectId: string): Promise<CommandHistory>
    removeHistory(projectId: string, command: string): Promise<CommandHistory>
    pin(projectId: string, command: string): Promise<CommandHistory>
    unpin(projectId: string, command: string): Promise<CommandHistory>
    onOutput(cb: (chunk: CommandOutputChunk) => void): () => void
    onTtyOutput(cb: (chunk: CommandTtyOutput) => void): () => void
    onExit(cb: (exit: CommandExit) => void): () => void
  }
  print: {
    /** Markdown / HTML ファイルの印刷用表示を別ウィンドウで開く。 */
    openPreview(projectId: string, relPath: string): Promise<void>
    /** 呼び出したウィンドウを OS の印刷ダイアログで印刷する。キャンセルされても resolve する。 */
    run(): Promise<void>
    /** HTML をそのページだけで（JavaScript を無効にして）OS の印刷ダイアログで印刷する。キャンセルされても resolve する。 */
    runHtml(html: string): Promise<void>
  }
}
