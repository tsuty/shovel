import type { AgentEntry, Project } from '@shared/types/project'
import { getAgentEntry } from '@shared/agentTable'
import { sbxExecCapture, sbxSecretSet } from '../sbx/cli'
import { projectsStore } from '../persistence/store'
import { openSandboxCommand } from './terminal'

/**
 * エージェントの認証状態の確認（対応表の statusCommand を実行し `loggedInPath` のキーだけを読む）と、
 * OS のターミナルでのサインインの起動を行う。
 */
export interface AuthStatus {
  loggedIn: boolean
  /** 対応表の statusCommand が壊れた JSON や非0終了を返した場合。 */
  checkFailed: boolean
}

function requireProjectAndAgent(projectId: string): { project: Project; agent: AgentEntry } {
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  const agent = getAgentEntry(project.agentId)
  if (!agent) throw new Error(`unknown agent: ${project.agentId}`)
  return { project, agent }
}

function readPath(value: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) return (acc as Record<string, unknown>)[key]
    return undefined
  }, value)
}

export async function checkAuthStatus(projectId: string): Promise<AuthStatus> {
  const { project, agent } = requireProjectAndAgent(projectId)
  const result = await sbxExecCapture(project.sandboxName, agent.auth.statusCommand, {
    cwd: project.sandboxPath
  })
  if (result.code !== 0) return { loggedIn: false, checkFailed: true }
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    const loggedIn = readPath(parsed, agent.auth.loggedInPath)
    return { loggedIn: loggedIn === true, checkFailed: false }
  } catch {
    return { loggedIn: false, checkFailed: true }
  }
}

export async function setApiKey(projectId: string, apiKey: string): Promise<void> {
  const { agent } = requireProjectAndAgent(projectId)
  // トークンは stdin 経由で渡す。
  await sbxSecretSet(agent.auth.secretService, apiKey)
}

export function openLoginTerminal(projectId: string): void {
  const { project, agent } = requireProjectAndAgent(projectId)
  openSandboxCommand(project.sandboxName, agent.auth.loginCommand)
}
