import type { Project } from '@shared/types/project'
import type { NetworkBlocks } from '@shared/types/network'
import { sbxPolicyAllowNetwork, sbxPolicyLog, sbxPolicyLs } from '../sbx/cli'
import { projectsStore } from '../persistence/store'
import { isAllowableResource, readBlockedEntries, readPolicyRules, summarizeBlocked } from './networkPolicy'

function findProject(id: string): Project {
  const project = projectsStore.list().find((p) => p.id === id)
  if (!project) throw new Error(`project not found: ${id}`)
  return project
}

/** プロジェクトのサンドボックスで拒否された通信のうち、いまのルールでもまだ通らないもの。 */
export async function getNetworkBlocks(id: string): Promise<NetworkBlocks> {
  const project = findProject(id)
  const [log, rules] = await Promise.all([sbxPolicyLog(project.sandboxName), sbxPolicyLs()])
  return {
    entries: summarizeBlocked(
      readBlockedEntries(log, project.sandboxName),
      readPolicyRules(rules),
      project.sandboxName,
      project.ignoredNetworkHosts ?? []
    )
  }
}

/** 宛先 `host:port` への通信を、このプロジェクトのサンドボックスだけに許可する。 */
export async function allowNetworkHost(id: string, host: string): Promise<void> {
  const project = findProject(id)
  if (!isAllowableResource(host)) throw new Error(`invalid host: ${host}`)
  await sbxPolicyAllowNetwork(project.sandboxName, host)
}

/** 宛先を無視リストに入れる／外す。 */
export function setNetworkHostIgnored(id: string, host: string, ignored: boolean): void {
  const project = findProject(id)
  const rest = (project.ignoredNetworkHosts ?? []).filter((h) => h !== host)
  projectsStore.upsert({ ...project, ignoredNetworkHosts: ignored ? [...rest, host] : rest })
}
