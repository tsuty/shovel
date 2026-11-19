import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import { acpAgentName } from './acpVersionService'
import {
  isSandboxProject,
  type LocalProject,
  type Project,
  type ProjectListResult,
  type ProjectStatus,
  type SandboxProject,
  type SandboxStatus,
  type SbxProblem
} from '@shared/types/project'
import type { SbxLsEntry } from '@shared/types/sbx'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'
import { alreadyRegisteredMessage } from '@shared/projectErrors'
import type {
  CreateExistingDirRequest,
  CreateFromExistingRequest,
  CreateLocalRequest,
  CreateNewDirRequest,
  DataDirKind,
  ImportableSandbox,
  ProjectDiagnostics,
  ProjectProgress
} from '@shared/ipc'
import { type SbxDiagnoseCheck, sbxCreate, sbxDiagnose, sbxDiagnoseChecks, sbxLs, sbxMeasureSandboxPath, sbxRm, sbxStop } from '../sbx/cli'
import { hostPathsEqual } from './pathTranslate'
import { removeAllRecordsForProject, snapshotDir } from '../persistence/snapshot'
import { openTabsStore, pickDirectoryStore, projectsStore } from '../persistence/store'
import { logsDir } from '../log'
import { applyLoginShellPath } from '../shellPath'

const SANDBOX_NAME_ALLOWED = /[^a-zA-Z0-9.+-]+/g

/** `sbx --name` に使える文字（英数字・ハイフン・ピリオド・プラス・マイナス）。 */
export function deriveSandboxName(seed: string, existingNames: ReadonlySet<string>): string {
  const base = seed.replace(SANDBOX_NAME_ALLOWED, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  if (!existingNames.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!existingNames.has(candidate)) return candidate
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

/**
 * shovel に登録されたプロジェクトと `sbx ls --json` を突き合わせた状態。
 *
 * Docker にサインインしていないと `sbx ls` は失敗する（あるいは一覧を返さない）ので、
 * 失敗したとき・登録済みのサンドボックスが見当たらないときは `sbx diagnose --json` で原因を確かめる。
 * 原因が sbx 側にあれば、「サンドボックスがありません」と誤って出さず `unknown` にする。
 */
export async function listProjectsWithStatus(): Promise<ProjectListResult> {
  const all = projectsStore.list()
  const projects = all.filter(isSandboxProject)
  const localStatuses = new Map<string, ProjectStatus>()
  for (const project of all) {
    if (!isSandboxProject(project)) localStatuses.set(project.id, await localStatus(project))
  }
  // サンドボックス無しのプロジェクトしか無ければ sbx を呼ばない（sbx が無い環境でも使えるように）。
  if (projects.length === 0) {
    return { projects: all.map((p) => ({ ...p, status: localStatuses.get(p.id) ?? 'local' })), sbxProblem: null }
  }
  let sandboxes: SbxLsEntry[] | null = null
  let sbxProblem: SbxProblem | null = null
  try {
    sandboxes = await sbxLsRetryingPath()
  } catch (err) {
    sbxProblem = isSbxNotFoundMessage(err instanceof Error ? err.message : String(err))
      ? 'notInstalled'
      : await diagnoseSbxProblem()
  }
  const listed = sandboxes
  if (listed && projects.some((p) => !listed.some((s) => s.id === p.sandboxId))) {
    // 見当たらないのが未サインインのせいなら、一覧は当てにならない。
    if ((await diagnoseSbxProblem()) === 'notSignedIn') {
      sandboxes = null
      sbxProblem = 'notSignedIn'
    }
  }
  const listedSandboxes = sandboxes
  return {
    projects: all.map((project) => ({
      ...project,
      status: isSandboxProject(project)
        ? listedSandboxes
          ? resolveStatus(project, listedSandboxes)
          : 'unknown'
        : (localStatuses.get(project.id) ?? 'local')
    })),
    sbxProblem
  }
}

async function localStatus(project: LocalProject): Promise<ProjectStatus> {
  const info = await stat(project.hostPath).catch(() => null)
  return info?.isDirectory() ? 'local' : 'workspace_missing'
}

/**
 * `sbx` が見つからなければ、ログインシェルの PATH を取り込み直してもう一度だけ試す。
 * 起動時の取り込みが（rc ファイルの遅さなどで）失敗していても、「再確認」で回復できるようにする。
 */
export async function sbxLsRetryingPath(): Promise<SbxLsEntry[]> {
  try {
    return await sbxLs()
  } catch (err) {
    if (!isSbxNotFoundMessage(err instanceof Error ? err.message : String(err))) throw err
    await applyLoginShellPath()
    return sbxLs()
  }
}

/** `sbx diagnose --json` の結果から、`sbx ls` が当てにならない理由を決める。 */
export function sbxProblemFromChecks(checks: SbxDiagnoseCheck[] | null): SbxProblem {
  const auth = checks?.find((c) => c.name.toLowerCase() === 'authentication')
  return auth?.status === 'fail' ? 'notSignedIn' : 'unavailable'
}

async function diagnoseSbxProblem(): Promise<SbxProblem> {
  return sbxProblemFromChecks(await sbxDiagnoseChecks().catch(() => null))
}

function resolveStatus(
  project: SandboxProject,
  sandboxes: { id: string; status: 'running' | 'stopped'; workspace_missing?: boolean }[]
): SandboxStatus {
  const match = sandboxes.find((s) => s.id === project.sandboxId)
  if (!match) return 'missing'
  if (match.workspace_missing) return 'workspace_missing'
  return match.status
}

export async function listImportableSandboxes(): Promise<ImportableSandbox[]> {
  const known = new Set(projectsStore.list().filter(isSandboxProject).map((p) => p.sandboxId))
  const sandboxes = await sbxLs()
  const items: ImportableSandbox[] = []
  for (const s of sandboxes) {
    if (known.has(s.id)) continue
    const hostPath = s.workspaces[0] ?? ''
    const registered = hostPath ? await findRegisteredProject(hostPath) : undefined
    items.push({
      sandboxName: s.name,
      sandboxId: s.id,
      agentId: getAgentEntry(s.agent) ? s.agent : null,
      sbxAgentRaw: s.agent,
      hostPath,
      status: s.status,
      registeredProjectName: registered?.displayName ?? null
    })
  }
  return items
}

async function canonicalPath(p: string): Promise<string> {
  return realpath(p).catch(() => p)
}

/**
 * このフォルダを使っている登録済みのプロジェクト。シンボリックリンクを解いた先が同じものも同じフォルダとみなす。
 */
export async function findRegisteredProject(hostPath: string): Promise<Project | undefined> {
  const real = await canonicalPath(hostPath)
  for (const project of projectsStore.list()) {
    if (hostPathsEqual(project.hostPath, hostPath)) return project
    if (hostPathsEqual(await canonicalPath(project.hostPath), real)) return project
  }
  return undefined
}

/** 同じフォルダのプロジェクトが登録済みなら、目印付きの Error を投げる。 */
async function assertNotRegistered(hostPath: string): Promise<void> {
  const registered = await findRegisteredProject(hostPath)
  if (registered) throw new Error(alreadyRegisteredMessage(registered.displayName))
}

export async function createFromNewDirectory(
  req: CreateNewDirRequest,
  onProgress: (p: ProjectProgress) => void
): Promise<Project> {
  const agent = getAgentEntry(req.agentId)
  if (!agent) throw new Error(`unknown agent: ${req.agentId}`)
  const hostPath = path.join(req.baseDir, req.dirName)
  await assertNotRegistered(hostPath)

  onProgress({ step: 'mkdir', message: 'プロジェクトディレクトリを作成しています…' })
  await mkdir(hostPath, { recursive: true })

  return createSandboxAndPersist({
    hostPath,
    displayName: req.displayName,
    agentId: req.agentId,
    sandboxName: req.sandboxName,
    onProgress
  })
}

export async function createFromExistingDirectory(
  req: CreateExistingDirRequest,
  onProgress: (p: ProjectProgress) => void
): Promise<Project> {
  const agent = getAgentEntry(req.agentId)
  if (!agent) throw new Error(`unknown agent: ${req.agentId}`)
  await assertNotRegistered(req.hostPath)
  const existingNames = new Set((await sbxLs().catch(() => [])).map((s) => s.name))
  const sandboxName = deriveSandboxName(path.basename(req.hostPath), existingNames)

  return createSandboxAndPersist({
    hostPath: req.hostPath,
    displayName: req.displayName,
    agentId: req.agentId,
    sandboxName,
    onProgress
  })
}

async function createSandboxAndPersist(args: {
  hostPath: string
  displayName: string
  agentId: string
  sandboxName: string
  onProgress: (p: ProjectProgress) => void
}): Promise<Project> {
  const agent = getAgentEntry(args.agentId)
  if (!agent) throw new Error(`unknown agent: ${args.agentId}`)

  args.onProgress({
    step: 'create',
    message: 'サンドボックスを作成しています…（初回はイメージ取得のため数分かかることがあります）'
  })
  await sbxCreate({
    sbxAgent: agent.sbxAgent,
    hostPath: args.hostPath,
    sandboxName: args.sandboxName,
    onOutput: (line) => args.onProgress({ step: 'create', message: line })
  })

  const sandboxes = await sbxLs()
  const created = sandboxes.find((s) => s.name === args.sandboxName)
  if (!created) throw new Error('sbx create succeeded but the sandbox could not be found afterwards')

  args.onProgress({ step: 'measure', message: 'ワークスペースのパスを確認しています…' })
  const sandboxPath = await sbxMeasureSandboxPath(args.sandboxName)

  const project: SandboxProject = {
    id: randomUUID(),
    displayName: args.displayName,
    hostPath: args.hostPath,
    sandboxPath,
    sandboxName: args.sandboxName,
    sandboxId: created.id,
    agentId: args.agentId,
    createdAt: Date.now()
  }
  projectsStore.upsert(project)
  return project
}

export async function createFromExistingSandbox(req: CreateFromExistingRequest): Promise<Project> {
  const sandboxes = await sbxLs()
  const match = sandboxes.find((s) => s.name === req.sandboxName)
  if (!match) throw new Error(`sandbox not found: ${req.sandboxName}`)
  const agent = getAgentEntry(match.agent)
  if (!agent) throw new Error(`unsupported agent for existing sandbox: ${match.agent}`)
  const hostPath = match.workspaces[0]
  if (!hostPath) throw new Error(`sandbox ${req.sandboxName} has no primary workspace`)
  await assertNotRegistered(hostPath)

  const sandboxPath = await sbxMeasureSandboxPath(req.sandboxName)
  const project: SandboxProject = {
    id: randomUUID(),
    displayName: req.displayName,
    hostPath,
    sandboxPath,
    sandboxName: match.name,
    sandboxId: match.id,
    agentId: agent.id,
    createdAt: Date.now()
  }
  projectsStore.upsert(project)
  return project
}

/** サンドボックス無しのプロジェクトを作る。新しいディレクトリなら作ってから登録する。 */
export async function createLocalProject(req: CreateLocalRequest): Promise<Project> {
  const hostPath =
    req.directory.kind === 'new' ? path.join(req.directory.baseDir, req.directory.dirName) : req.directory.hostPath
  await assertNotRegistered(hostPath)
  if (req.directory.kind === 'new') {
    await mkdir(hostPath, { recursive: true })
  } else {
    const info = await stat(hostPath).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`not a directory: ${hostPath}`)
  }
  const project: LocalProject = {
    kind: 'local',
    id: randomUUID(),
    displayName: req.displayName,
    hostPath,
    createdAt: Date.now()
  }
  projectsStore.upsert(project)
  return project
}

export function renameProject(id: string, displayName: string): void {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
  projectsStore.upsert({ ...project, displayName })
}

export async function removeProject(id: string, trashHostDir: boolean): Promise<void> {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)

  if (isSandboxProject(project)) {
    await sbxRm(project.sandboxName).catch(() => {
      // サンドボックスが無くても登録は削除する。
    })
  }
  if (trashHostDir) {
    await shell.trashItem(project.hostPath)
  }

  // バックアップ・削除済みを含めてスナップショットを削除する。
  await removeAllRecordsForProject(project.id)
  openTabsStore.remove(project.id)

  projectsStore.remove(id)
}

export async function pickDirectory(): Promise<string | null> {
  // 前回選んだフォルダの親から開く。消えていれば Electron の既定（ダウンロード）に任せる。
  const lastDir = pickDirectoryStore.get()
  const defaultPath = lastDir && (await stat(lastDir).catch(() => null))?.isDirectory() ? lastDir : undefined
  const result = await dialog.showOpenDialog({ defaultPath, properties: ['openDirectory', 'createDirectory'] })
  const picked = result.canceled ? undefined : result.filePaths[0]
  if (!picked) return null
  pickDirectoryStore.set(path.dirname(picked))
  return picked
}

export async function diagnose(): Promise<string> {
  return sbxDiagnose()
}

/** プロジェクト詳細ダイアログの診断情報。 */
const RECENT_LOG_LINES = 500

/** プロジェクトのログディレクトリから最後のセッションのログを探す。 */
async function findLatestLogFile(projectId: string): Promise<string | null> {
  const dir = logsDir(projectId)
  const entries = await readdir(dir).catch(() => [])
  const matches = entries.filter((f) => f.endsWith('.log')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  const latest = matches[matches.length - 1]
  return latest ? path.join(dir, latest) : null
}

/**
 * ログ行 `{ms} {OUT|IN} {raw JSON}` / `{ms} STDERR {text}` を種別ごとに振り分け、
 * 末尾 `RECENT_LOG_LINES` 行に切り詰める。
 */
async function readSessionLogs(projectId: string): Promise<Pick<ProjectDiagnostics, 'acpTrafficLog' | 'stderrLog'>> {
  const file = await findLatestLogFile(projectId)
  if (!file) return { acpTrafficLog: null, stderrLog: null }
  const raw = await readFile(file, 'utf8').catch(() => '')
  const rpcLines: string[] = []
  const stderrLines: string[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const match = /^\d+ (OUT|IN|STDERR) /.exec(line)
    if (!match) continue
    ;(match[1] === 'STDERR' ? stderrLines : rpcLines).push(line)
  }
  return {
    acpTrafficLog: rpcLines.length > 0 ? rpcLines.slice(-RECENT_LOG_LINES).join('\n') : null,
    stderrLog: stderrLines.length > 0 ? stderrLines.slice(-RECENT_LOG_LINES).join('\n') : null
  }
}

export async function getProjectDiagnostics(id: string): Promise<ProjectDiagnostics> {
  const project = projectsStore.findSandbox(id)
  if (!project) throw new Error(`sandbox project not found: ${id}`)
  const [diagnoseOutput, sandboxes, logs] = await Promise.all([
    sbxDiagnose(),
    sbxLs().catch(() => []),
    readSessionLogs(id)
  ])
  const sbxLsEntry = sandboxes.find((s) => s.id === project.sandboxId) ?? null
  const agent = getAgentEntry(project.agentId)
  const agentName = agent ? acpAgentName(agent) : project.agentId
  return {
    project,
    agentName,
    diagnoseOutput,
    sbxLsEntry,
    ...logs,
    logsDir: logsDir(id),
    snapshotsDir: snapshotDir(id)
  }
}

export async function openDataDir(id: string, kind: DataDirKind): Promise<void> {
  if (kind === 'logs') {
    const latest = await findLatestLogFile(id)
    if (latest) {
      shell.showItemInFolder(latest)
      return
    }
  }
  const dir = kind === 'logs' ? logsDir(id) : snapshotDir(id)
  // ログディレクトリが無ければ空で返す。
  await mkdir(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}

export async function stopProject(id: string): Promise<void> {
  const project = projectsStore.findSandbox(id)
  if (!project) throw new Error(`sandbox project not found: ${id}`)
  await sbxStop(project.sandboxName)
}
