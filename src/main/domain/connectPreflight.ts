import type { AgentEntry, Project } from '@shared/types/project'
import type { SbxLsEntry } from '@shared/types/sbx'
import type { SessionOpenStep } from '@shared/ipc'
import { AUTH_REQUIRED_MARKER } from '@shared/authMarker'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'
import {
  classifyExecFailure,
  classifySbxFailure,
  listedSandboxProblem,
  sandboxUnreachableMessage
} from '@shared/sandboxUnreachable'
import { sbxDiagnoseChecks, sbxLivenessCheck, sbxLs } from '../sbx/cli'
import { checkAgentAuthStatus } from './authService'

/**
 * ACP アダプタを起動する前の確認。新しいチャットでも履歴の再開でも同じ順に行う。
 *   1. Docker へのサインインとサンドボックスの有無（`sbx ls --json`。失敗したら `sbx diagnose` で原因を調べる）
 *   2. エージェントのログイン状態（未ログインなら `AUTH_REQUIRED`。確認自体の失敗は止めない）
 *   3. 2 のコマンドが非0で終わったときだけ、サンドボックスへの到達（`sbx exec <name> echo`）。
 *      非0の原因が `sbx exec` 自体か statusCommand かを見分ける
 */
export async function runConnectPreflight(
  project: Project,
  agent: AgentEntry,
  onProgress?: (step: SessionOpenStep, detail?: string) => void
): Promise<void> {
  onProgress?.('docker', 'sbx ls --json')
  const listed = await findSandbox(project)

  onProgress?.('auth', `sbx exec ${project.sandboxName} ${agent.auth.statusCommand.join(' ')}`)
  const status = await checkAgentAuthStatus(project, agent)
  if (!status.checkFailed && !status.loggedIn) throw new Error(AUTH_REQUIRED_MARKER)
  if (status.exitedZero) return

  onProgress?.('sandbox', `sbx exec ${project.sandboxName} echo`)
  if (await sbxLivenessCheck(project.sandboxName)) return
  throw new Error(sandboxUnreachableMessage(classifyExecFailure(listed)))
}

/** `sbx ls --json` でプロジェクトのサンドボックスを探す。接続できないと分かれば原因付きで投げる。 */
async function findSandbox(project: Project): Promise<SbxLsEntry> {
  let sandboxes: SbxLsEntry[]
  try {
    sandboxes = await sbxLs()
  } catch (err) {
    if (isSbxNotFoundMessage(err instanceof Error ? err.message : String(err))) throw err
    const checks = await sbxDiagnoseChecks().catch(() => null)
    throw new Error(sandboxUnreachableMessage(classifySbxFailure(checks)), { cause: err })
  }
  const listed = sandboxes.find((s) => s.id === project.sandboxId) ?? null
  const problem = listedSandboxProblem(listed)
  if (problem || !listed) throw new Error(sandboxUnreachableMessage(problem ?? { reason: 'missing' }))
  return listed
}
