import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import { acpAgentName } from './acpVersionService'
import type { Project, ProjectListResult, SandboxStatus, SbxProblem } from '@shared/types/project'
import type { SbxLsEntry } from '@shared/types/sbx'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'
import type {
  CreateExistingDirRequest,
  CreateFromExistingRequest,
  CreateNewDirRequest,
  DataDirKind,
  ImportableSandbox,
  ProjectDiagnostics,
  ProjectProgress
} from '@shared/ipc'
import { type SbxDiagnoseCheck, sbxCreate, sbxDiagnose, sbxDiagnoseChecks, sbxLs, sbxMeasureSandboxPath, sbxRm, sbxStop } from '../sbx/cli'
import { hostPathsEqual } from './pathTranslate'
import { removeAllRecordsForProject, snapshotDir } from '../persistence/snapshot'
import { pickDirectoryStore, projectsStore } from '../persistence/store'
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
  const projects = projectsStore.list()
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
  return {
    projects: projects.map((project) => ({
      ...project,
      status: sandboxes ? resolveStatus(project, sandboxes) : 'unknown'
    })),
    sbxProblem
  }
}

/**
 * `sbx` が見つからなければ、ログインシェルの PATH を取り込み直してもう一度だけ試す。
 * 起動時の取り込みが（rc ファイルの遅さなどで）失敗していても、「再確認」で回復できるようにする。
 */
async function sbxLsRetryingPath(): Promise<SbxLsEntry[]> {
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
  project: Project,
  sandboxes: { id: string; status: 'running' | 'stopped'; workspace_missing?: boolean }[]
): SandboxStatus {
  const match = sandboxes.find((s) => s.id === project.sandboxId)
  if (!match) return 'missing'
  if (match.workspace_missing) return 'workspace_missing'
  return match.status
}

export async function listImportableSandboxes(): Promise<ImportableSandbox[]> {
  const projects = projectsStore.list()
  const known = new Set(projects.map((p) => p.sandboxId))
  const sandboxes = await sbxLs()
  return sandboxes
    .filter((s) => !known.has(s.id))
    .map((s) => ({
      sandboxName: s.name,
      sandboxId: s.id,
      agentId: getAgentEntry(s.agent) ? s.agent : null,
      sbxAgentRaw: s.agent,
      hostPath: s.workspaces[0] ?? '',
      status: s.status
    }))
}

export async function createFromNewDirectory(
  req: CreateNewDirRequest,
  onProgress: (p: ProjectProgress) => void
): Promise<Project> {
  const agent = getAgentEntry(req.agentId)
  if (!agent) throw new Error(`unknown agent: ${req.agentId}`)
  const hostPath = path.join(req.baseDir, req.dirName)

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

  const project: Project = {
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

  const sandboxPath = await sbxMeasureSandboxPath(req.sandboxName)
  const project: Project = {
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

export function renameProject(id: string, displayName: string): void {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
  projectsStore.upsert({ ...project, displayName })
}

export async function removeProject(id: string, trashHostDir: boolean): Promise<void> {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)

  await sbxRm(project.sandboxName).catch(() => {
    // サンドボックスが無くても登録は削除する。
  })
  if (trashHostDir) {
    await shell.trashItem(project.hostPath)
  }

  // バックアップ・削除済みを含めてスナップショットを削除する。
  await removeAllRecordsForProject(project.id)

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
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
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
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
  await sbxStop(project.sandboxName)
}

export function findProjectByHostPath(hostPath: string): Project | undefined {
  return projectsStore.list().find((p) => hostPathsEqual(p.hostPath, hostPath))
}
