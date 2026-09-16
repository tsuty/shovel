import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import type { Project, ProjectWithStatus, SandboxStatus } from '@shared/types/project'
import type {
  CreateExistingDirRequest,
  CreateFromExistingRequest,
  CreateNewDirRequest,
  ImportableSandbox,
  ProjectDiagnostics,
  ProjectProgress
} from '@shared/ipc'
import { sbxCreate, sbxDiagnose, sbxLs, sbxMeasureSandboxPath, sbxRm, sbxStop } from '../sbx/cli'
import { hostPathsEqual } from './pathTranslate'
import { deleteSnapshot, listSnapshotsForProject } from '../persistence/snapshot'
import { projectsStore } from '../persistence/store'
import { logsDir } from '../log'

const SANDBOX_NAME_ALLOWED = /[^a-zA-Z0-9.+-]+/g

/** `sbx --name` が許すのは英数字・ハイフン・ピリオド・プラス・マイナスのみ（architecture.md §7）。 */
export function deriveSandboxName(seed: string, existingNames: ReadonlySet<string>): string {
  const base = seed.replace(SANDBOX_NAME_ALLOWED, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  if (!existingNames.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!existingNames.has(candidate)) return candidate
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

/** data-model.md §5 / decisions.md N-2-2: shovel の設定を正とし、sbx ls --json との差分を提示する。 */
export async function listProjectsWithStatus(): Promise<ProjectWithStatus[]> {
  const projects = projectsStore.list()
  const sandboxes = await sbxLs().catch(() => [])
  return projects.map((project) => ({ ...project, status: resolveStatus(project, sandboxes) }))
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
    // 既にサンドボックスが無い場合でも、shovel 側の登録は削除できるようにする。
  })
  if (trashHostDir) {
    await shell.trashItem(project.hostPath)
  }

  const snapshots = await listSnapshotsForProject(project.id)
  for (const snapshot of snapshots) await deleteSnapshot(snapshot.sessionId)

  projectsStore.remove(id)
}

export async function pickDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export async function diagnose(): Promise<string> {
  return sbxDiagnose()
}

/** ui.md §2「プロジェクトの詳細」の診断情報。N-2-6: まとめてコピーできる形にする。 */
const RECENT_LOG_LINES = 500

/** `src/main/log.ts` が書くファイル名 `{ms}_{projectId}_{sessionId}.log` から、このプロジェクトの最後のセッションのログを逆引きする。 */
async function findLatestLogFile(projectId: string): Promise<string | null> {
  const dir = logsDir()
  const entries = await readdir(dir).catch(() => [])
  const matches = entries.filter((f) => f.includes(`_${projectId}_`)).sort()
  const latest = matches[matches.length - 1]
  return latest ? path.join(dir, latest) : null
}

/**
 * decisions.md N-2-6「診断情報画面」。SAC 方式のログ行 `{ms} {OUT|IN} {raw JSON}` /
 * `{ms} STDERR {text}` を種別ごとに振り分け、末尾 `RECENT_LOG_LINES` 行に切り詰める。
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
  return { project, diagnoseOutput, sbxLsEntry, ...logs }
}

export async function stopProject(id: string): Promise<void> {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
  await sbxStop(project.sandboxName)
}

export function findProjectByHostPath(hostPath: string): Project | undefined {
  return projectsStore.list().find((p) => hostPathsEqual(p.hostPath, hostPath))
}
