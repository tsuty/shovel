import type { AgentEntry } from './types/project'

/** エージェント対応表。 */
export const AGENT_TABLE: readonly AgentEntry[] = [
  {
    id: 'claude',
    label: 'Claude',
    sbxAgent: 'claude',
    acpPackage: '@agentclientprotocol/claude-agent-acp',
    status: 'verified',
    auth: {
      statusCommand: ['claude', 'auth', 'status', '--json'],
      loggedInPath: 'loggedIn',
      loginCommand: ['claude', 'auth', 'login'],
      secretService: 'anthropic'
    }
  }
] as const

export function getAgentEntry(agentId: string): AgentEntry | undefined {
  return AGENT_TABLE.find((a) => a.id === agentId)
}

export function verifiedAgents(): AgentEntry[] {
  return AGENT_TABLE.filter((a) => a.status === 'verified')
}
