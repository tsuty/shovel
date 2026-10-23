import { net } from 'electron'
import { AGENT_TABLE, getAgentEntry } from '@shared/agentTable'
import {
  ACP_REGISTRY_URL,
  compareVersions,
  findRegistryEntry,
  isValidVersion,
  withAcpRollback,
  withAcpUpdate
} from '@shared/acpVersion'
import type { AcpUpdateOffer, AgentEntry, Project } from '@shared/types/project'
import { acpRegistryStore, projectsStore } from '../persistence/store'

/**
 * ACP アダプタのバージョン管理。
 *   1. プロジェクトマネージャを開いたとき、ACP レジストリから最新版を読んで控える。
 *   2. セッション開始時、エージェントが `initialize` で告げた版をプロジェクトに記録する。
 *   3. プロジェクトのウィンドウを開いたとき、控えた最新版が記録より新しければ更新するか尋ねる。
 *   4. 更新した後、プロジェクトの詳細から更新前の版に戻せる。
 */

const REGISTRY_FETCH_TIMEOUT_MS = 10_000

/** ACP レジストリを読み、対応表の各エージェントの表示名と最新版を控える。失敗してもログだけ残す。 */
export async function refreshLatestAcpVersions(): Promise<void> {
  try {
    const response = await net.fetch(ACP_REGISTRY_URL, { signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const registry: unknown = await response.json()
    for (const agent of AGENT_TABLE) {
      const entry = findRegistryEntry(registry, agent.acpPackage)
      if (entry) acpRegistryStore.set(agent.acpPackage, entry)
    }
  } catch (err) {
    console.warn('[acp-version] failed to fetch the ACP registry', err)
  }
}

/** `npx -y` に渡すパッケージ指定。プロジェクトに記録した版、無ければ控えた最新版、それも無ければ `@latest`。 */
export function acpPackageSpec(project: Project, agent: AgentEntry): string {
  const version = project.acpVersion ?? acpRegistryStore.get(agent.acpPackage)?.version
  return `${agent.acpPackage}@${version ?? 'latest'}`
}

/** エージェントの表示名。ACP レジストリの `name`（例: `Claude Agent`）、未取得なら対応表の `label`。 */
export function acpAgentName(agent: AgentEntry): string {
  return acpRegistryStore.get(agent.acpPackage)?.name ?? agent.label
}

/** セッション開始時に、エージェントが告げた版をプロジェクトに記録する。 */
export function recordAcpVersion(projectId: string, version: unknown): void {
  if (!isValidVersion(version)) return
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project || project.acpVersion === version) return
  projectsStore.upsert({ ...project, acpVersion: version })
}

/** 更新を尋ねるべきなら、その内容。尋ねなくてよければ null。 */
export function getAcpUpdateOffer(projectId: string): AcpUpdateOffer | null {
  const project = projectsStore.list().find((p) => p.id === projectId)
  const agent = project && getAgentEntry(project.agentId)
  if (!project?.acpVersion || !agent) return null
  const latest = acpRegistryStore.get(agent.acpPackage)?.version
  if (!latest || compareVersions(latest, project.acpVersion) <= 0) return null
  if (project.skippedAcpVersion && compareVersions(latest, project.skippedAcpVersion) <= 0) return null
  return { agentName: acpAgentName(agent), current: project.acpVersion, latest }
}

/** 更新の確認への答え。更新するなら記録する版を最新版に（前の版は残す）、しないならその版を見送り済みにする。 */
export function resolveAcpUpdate(projectId: string, update: boolean): void {
  const offer = getAcpUpdateOffer(projectId)
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!offer || !project) return
  projectsStore.upsert(
    update ? withAcpUpdate(project, offer.latest) : { ...project, skippedAcpVersion: offer.latest }
  )
}

/** 記録する版を更新前の版に戻す。戻せる版が無ければ何もしない。 */
export function rollbackAcpVersion(projectId: string): void {
  const project = projectsStore.list().find((p) => p.id === projectId)
  const rolledBack = project && withAcpRollback(project)
  if (rolledBack) projectsStore.upsert(rolledBack)
}
