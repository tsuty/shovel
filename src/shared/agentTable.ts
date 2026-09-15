import type { AgentEntry } from './types/project'

/**
 * エージェント対応表。アプリに同梱する（data-model.md §2、decisions.md N-2-5）。
 *
 * `shell` は使わない。`sbx create claude` で作られた環境には、エージェント本体と
 * 認証経路がセットアップ済みであり、その上に ACP アダプタを `npx` で足すだけで
 * 済むため。`status: "verified"` のものだけを UI に出す方針（N-2-5）に従い、
 * まず claude の 1 組だけを収録する。2 組目を追加するときに、この配列へ
 * エントリを足すだけで済むよう、構造は複数エージェントを見越して定義してある。
 */
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
